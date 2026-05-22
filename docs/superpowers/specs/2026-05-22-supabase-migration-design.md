# Prime Dashboard — Supabase Migration & Architecture Rebuild

**Status:** Draft, pending user review
**Date:** 2026-05-22
**Target ship:** 2026-05-25/26 (3–4 days)
**Reviewer post-implementation:** CODEX

---

## Purpose

The current dashboard runs DuckDB embedded in a Next.js process on a single
machine. Architectural review (this conversation's earlier turn) found three
load-bearing problems: silent classification drift via `v_max_date`, the same
classification CTE duplicated across four call sites, and 14 copies of a
"3MR source" subquery scanning `sdd_awbs` at query time. None of these are
acceptable for a 50-user production dashboard.

This spec covers a coordinated rebuild: migrate the data layer to Supabase
Postgres, replace the 14-CTE pattern with pre-aggregated tables, add
authentication with admin/viewer roles, and deploy to Railway. The dashboard's
visible behaviour stays the same except where the review flagged it as wrong.

**Out of scope:** UI refactor, new features, the frontend dedup work from the
review (those are week-2+).

---

## Goals

1. **Correctness.** Eliminate the `GREATEST()` drift bug. Single source of
   truth for rider classification. Configuration changes propagate to every
   query.
2. **Responsiveness.** D-1 and L8D views — the most-used in the dashboard —
   load in under 50ms from pre-aggregated tables. No ad-hoc scans of raw
   shipment data on the request path.
3. **Scalability.** 50 concurrent users without thread contention. Connection
   pool sized for the load. Free-tier Supabase ($0/mo) sufficient for at least
   the first 6 months.
4. **Security.** Email/password auth with admin/viewer roles. No unauthenticated
   access except `/api/status`.
5. **Operability.** Manual CSV upload via admin UI replaces folder-watcher.
   Idempotent ingest. Atomic per-file transactions. Visible data-freshness
   chip in the nav.

---

## Non-goals

- Drilldown to individual AWB number (explicitly dropped — user confirmed).
- SSO, MFA, password reset emails (deferrable to v2).
- Multi-tenancy / per-city role scoping (admin/viewer only for day 1).
- Migrating frontend components (still 300–500 line page files — week 2).
- Real-time updates / websockets (revalidate-on-fetch is sufficient).

---

## Architecture Overview

```
┌─────────────────────┐         ┌──────────────────────────────┐
│   Railway (Node)    │         │   Supabase (Postgres + Auth) │
│                     │ ──────► │                              │
│   Next.js app       │  pg     │   Tables:                    │
│   /app/api/*        │  pool   │     rider_daily              │
│   /app/(pages)/*    │         │     rider_day_shipments      │
│   /app/admin/*      │         │     client_day_shipments     │
│                     │         │     hub_day_l8d  ← L8D       │
│   backend/          │         │     data_anchor              │
│     ingest-pg.js    │         │     app_users, app_config    │
│     db-pg.ts        │         │   Functions:                 │
│     queries/*       │         │     classify_riders()        │
│                     │         │   Auth: built-in             │
└─────────────────────┘         └──────────────────────────────┘
         ▲
         │ admin uploads CSV via /admin/upload
         │
   [SDD_Data CSVs]
```

**Request lifecycle (read path, e.g. Daily Perf page):**

1. Browser sends GET `/api/details/trend?mode=3mr`
2. Middleware checks Supabase session cookie → 200 if authed, 302 to /login else
3. Route handler calls `getL8DTrend({ mode: '3mr' })` from `backend/queries/trends.ts`
4. Query is a single `SELECT … FROM hub_day_l8d WHERE date BETWEEN …`
5. Postgres returns ~40k rows in <10ms
6. Route handler shapes the JSON response
7. Next.js caches the response for 60s (`revalidate = 60`)

**Request lifecycle (write path, ingest):**

1. Admin signs in, navigates to `/admin/upload`
2. Selects one or more CSVs (rider daily, SDD AWBs, hub mapping, etc.)
3. Server-side route receives files, runs `ingestFiles(files)`
4. For each file: read with csv-parse → aggregate in Node → batched UPSERT → log
5. After all files succeed: TRUNCATE+INSERT `hub_day_l8d` for affected dates
6. Update `data_anchor` row in same transaction
7. Call `revalidateTag('ingest')` to bust Next.js cache
8. Return summary (rows ingested, max date, drift detected if any)

---

## Section 1 — Data Model

Already written and committed at [`sql/schema.sql`](../../sql/schema.sql).
Key tables:

| Table | Purpose | Rows (est.) |
|---|---|---|
| `hub_mapping` | hub → city/zone reference | ~500 |
| `cpo` | per-city pay rates | ~25 |
| `prime_clients` | C2 client list | ~30 |
| `rider_daily` | per-rider per-day login + attempts | ~5000/day |
| `rider_day_shipments` | pre-agg per-rider per-day shipments (3MR + Overall) | ~5000/day |
| `client_day_shipments` | pre-agg per-client per-day shipments | ~100/day |
| `hub_day_l8d` | L8D pre-roll, hub-day grain | ~500 × 8 = 4000 |
| `data_anchor` | singleton: rider_daily_max + shipments_max + anchor_date | 1 |
| `app_users` | mirrors auth.users with role | ≤50 |
| `app_config` | singleton: global settings | 1 |
| `ingest_log` | per-file hash + timestamp | grows with files |

**Single source of truth for classification:** `classify_riders(window_days,
new_rider_days, evening_threshold, cross_threshold, regular_threshold)`
function. Called by every API route that needs rider tags. No more 4 copies.

**Drift fix:** `data_anchor.anchor_date` is a generated `LEAST(rider_daily_max,
shipments_max)`. Every query uses this anchor, never `max()` at query time.
Drift is surfaced in `/api/status`.

**Storage projection:** ~25MB steady state (90 days of history). 20× headroom
under the Supabase 500MB free tier.

**L8D query pattern (the hot path):**

```sql
-- D-1 overall totals (top KPI cards)
SELECT SUM(riders_active), SUM(delivered_3mr), …
FROM hub_day_l8d
WHERE date = (SELECT anchor_date FROM data_anchor);
-- ~1ms

-- L8D city trend (the Daily Perf trend table)
SELECT date, city, SUM(delivered_3mr), …
FROM hub_day_l8d
GROUP BY date, city
ORDER BY city, date;
-- ~5ms

-- D-1 vs L7D-avg delta (the chip on every trend row)
WITH d1 AS (… WHERE date = anchor_date),
     l7 AS (… WHERE date BETWEEN anchor_date-7 AND anchor_date-1
            GROUP BY hub)
SELECT d1.hub, d1.delivered_3mr, l7.avg_delivered
FROM d1 LEFT JOIN l7 USING (hub);
-- ~10ms
```

---

## Section 2 — Ingest Pipeline

**Replaces:** `backend/ingest.js` (DuckDB-specific), `backend/watcher.js`
(folder watcher — won't work on Railway).

**New files:**

| File | Purpose |
|---|---|
| `backend/db-pg.ts` | pg connection pool, `query()`, `transaction()` |
| `backend/ingest-pg.ts` | Core ingest logic, exported functions for each step |
| `backend/migrate-from-duckdb.js` | One-shot ETL from existing prime.duckdb to Supabase |
| `app/api/admin/upload/route.ts` | Admin-only endpoint that accepts CSV uploads |
| `app/admin/upload/page.tsx` | UI for the upload + ingest results |

**Key design decisions:**

1. **Aggregate in Node, not in SQL.** Raw SDD CSVs (~50k rows/day) are parsed
   in Node, aggregated into a `Map<dateRiderHub, metrics>`, and UPSERTed in
   batches of 1000. Raw AWB rows never enter Postgres. Saves storage and
   eliminates the "GROUP BY at query time" anti-pattern.

2. **UPSERT semantics (idempotent).** All inserts use `ON CONFLICT (…) DO
   UPDATE SET …`. Re-running ingest for a file is safe — same data overwrites,
   conflicting data is a bug surfaced separately.

3. **Per-file transactions.** Each CSV is one transaction. File 5 of 20 failing
   doesn't roll back files 1–4. `ingest_log` records `file_hash` (md5 of
   bytes); a content change re-ingests, a filename collision does not silently
   drop the fix.

4. **L8D refresh as final step.** After all CSVs ingest:
   ```
   BEGIN;
     DELETE FROM hub_day_l8d WHERE date >= (anchor - 7);
     INSERT INTO hub_day_l8d SELECT … FROM rider_day_shipments WHERE date >= (anchor - 7);
     UPDATE data_anchor SET rider_daily_max = …, shipments_max = …;
   COMMIT;
   ```
   Atomic — readers either see fully-updated L8D + anchor, or fully-old. No
   torn state.

5. **Drift detection.** After update, compute `rider_daily_max - shipments_max`.
   If non-zero, log + return in upload response. Surfaced in nav chip too.

**Classification is read-path, not write-path.** Ingest writes raw login data
to `rider_daily` only. The `classify_riders()` function is called from API
routes at request time, against the current `app_config`. This keeps ingest
fast, lets config changes propagate instantly without re-ingest, and
guarantees no stale classification rows.

**Migration ETL (`migrate-from-duckdb.js`):**

One-shot script run locally:

```bash
DATABASE_URL=postgres://… node backend/migrate-from-duckdb.js
```

1. Opens `prime.duckdb` read-only
2. Reads `hub_mapping`, `cpo`, `prime_clients` → COPY to Postgres
3. Reads `rider_daily` → COPY to Postgres (~600KB, one shot)
4. Runs DuckDB-side aggregation queries against `sdd_awbs` to produce
   per-day per-rider-hub metrics → streams to Postgres in batches
5. Computes `client_day_shipments` similarly
6. Refreshes `hub_day_l8d`
7. Sets `data_anchor`
8. Prints summary: rows migrated, anchor date, time taken

Expected runtime: 2–5 minutes for full historical migration.

After successful migration: rename `prime.duckdb` → `prime.duckdb.archive`
and delete `backend/ingest.js`, `backend/watcher.js`.

---

## Section 3 — Query Layer

**Replaces:** the inline SQL in every `app/api/*/route.ts`. The 14 copies of
the `mr3_src` CTE are deleted, not refactored.

**New structure:**

```
backend/
  db-pg.ts                      — pool, query<T>(sql, params), transaction(fn)
  queries/
    classification.ts           — getClassifiedRiders(cfg)
    shipments.ts                — getHubDay, getCityDay, getRiderDay (params: dateRange, filters)
    trends.ts                   — getL8DByHub, getL8DByCity, getL8DOverall
    deltas.ts                   — getD1vsL7DAvg, getL7DvsPrev, getL30DvsPrev
    demand.ts                   — getDemandByCity, getDemandByClient, getClientSparkline
    riders.ts                   — getRiderProfile, getRiderShipments30d
    config.ts                   — getAppConfig, updateAppConfig (admin only)
```

Each query function:
- Takes a typed args object
- Returns typed rows (no `Record<string, unknown>` at the boundary)
- Uses parameterized SQL (`$1`, `$2` — pg style)
- Does coercion + shape transformation in JS, not SQL

**API route shape (after refactor):**

```ts
// app/api/details/trend/route.ts (NEW shape — ~30 lines)
export async function GET(req: Request) {
  await requireUser(req)
  const { mode, mr3CutoffHour } = parseParams(req.url)
  const config = await getAppConfig()
  const rows = await getL8DByCity({ mode, config })
  return NextResponse.json(shapeTrendResponse(rows))
}
```

Compare to the current 226-line file with three duplicated subquery blocks.

**Caching:**
- `export const revalidate = 60` on every route (down from 300; data changes
  more often than every 5 min and freshness > caching)
- `revalidateTag('ingest')` called from ingest completion bus the entire cache
- Browser keeps existing fetch+useState pattern

**Connection pool:**

```ts
// backend/db-pg.ts
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
})
```

Supabase free tier allows 60 direct + 200 transaction-pooler connections. 10
is comfortable for 50 users.

---

## Section 4 — Auth + Roles

**Provider:** Supabase Auth (email/password).

**Roles:** `admin` and `viewer` only. Stored in `app_users.role` (TEXT, CHECK
constraint).

**New files:**

| File | Purpose |
|---|---|
| `lib/supabase-server.ts` | Server-side Supabase client (service role) |
| `lib/supabase-browser.ts` | Browser-side client (anon key, with session) |
| `lib/auth.ts` | `getSession()`, `requireUser()`, `requireAdmin()` |
| `middleware.ts` | Route protection — redirects unauth → /login |
| `app/login/page.tsx` | Email/password sign-in form |
| `app/logout/route.ts` | Clears session, redirects to /login |
| `app/admin/users/page.tsx` | Admin-only: list, invite, set role |
| `components/auth-provider.tsx` | Client-side session context |

**Authorization rules:**

| Resource | Anon | Viewer | Admin |
|---|---|---|---|
| `/login`, `/api/status` | ✅ | ✅ | ✅ |
| All other pages, `/api/*` | ❌ (302 → /login) | ✅ read | ✅ |
| Config drawer (UI) | ❌ | ❌ (hidden) | ✅ |
| `PATCH /api/admin/config` | ❌ | ❌ (403) | ✅ |
| `/admin/upload`, `/admin/users` | ❌ | ❌ (403) | ✅ |

**Bootstrapping the first admin:**

1. Schema applied to Supabase (no admin users exist)
2. You sign up via `/login` page → row in `auth.users` + `app_users` created
   automatically with `role='viewer'`
3. Run one SQL command in Supabase SQL editor:
   `UPDATE app_users SET role='admin' WHERE email='you@example.com';`
4. From then on, you create new admins via the `/admin/users` UI

**Auto-create `app_users` row on first sign-in:**

A Supabase database trigger inserts into `app_users` whenever `auth.users` gets
a new row. The trigger SQL is **not yet in `sql/schema.sql`** — it will be
appended during Day 3 (Auth) implementation, because it references the
`auth.users` table which only exists once the Supabase project is provisioned.

```sql
CREATE OR REPLACE FUNCTION handle_new_user() RETURNS TRIGGER … AS $$
  INSERT INTO app_users (id, email, role) VALUES (NEW.id, NEW.email, 'viewer')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
```

**Session handling:** Supabase sets an httpOnly cookie. Middleware reads it,
verifies with the Supabase server SDK, looks up role from `app_users`, attaches
to request via header passing or context. No third-party session library.

---

## Section 5 — Deployment

**Platform:** Railway. Single Node service deployed from GitHub `main`.

**Environment variables (set in Railway dashboard):**

```
DATABASE_URL                = postgres://…@…supabase.co:5432/postgres
SUPABASE_URL                = https://…supabase.co
SUPABASE_ANON_KEY           = ey…  (public)
SUPABASE_SERVICE_ROLE_KEY   = ey…  (server-only, never exposed)
NEXT_PUBLIC_SUPABASE_URL    = same as SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY = same as SUPABASE_ANON_KEY
```

**Build:** Railway autodetects Next.js, runs `npm run build`. No custom
Dockerfile needed.

**File uploads:** Admin upload page accepts CSV multipart. Files written to
Railway's ephemeral filesystem (`/tmp`), processed by ingest, deleted after
success. No persistent disk needed because all data lives in Postgres.

**No cron, no watcher.** Ingest is admin-triggered only for v1.

**Backups:** Supabase free tier — daily automated, 7-day retention.

**Monitoring:** Railway logs + CPU/RAM dashboard. No Sentry/Datadog for v1.

**Estimated cost:** $0/mo (Supabase free + Railway hobby plan with $5/mo
free credit covering Node app).

---

## Migration Plan (high level — detailed plan in writing-plans output)

```
Day 1  ─  Database
         ✓ Create Supabase project, get DATABASE_URL
         ✓ Run sql/schema.sql via psql
         ✓ Write migrate-from-duckdb.js
         ✓ Test migration on a copy of prime.duckdb
         ✓ Verify row counts + spot-check classifications match old vs new

Day 2  ─  Ingest + Query layer
         ✓ Write backend/db-pg.ts + connection pool
         ✓ Write backend/ingest-pg.ts
         ✓ Build backend/queries/* (replace inline CTEs)
         ✓ Rewrite each /api/* route to use new queries
         ✓ Run dashboard locally against Supabase — verify every tab loads

Day 3  ─  Auth + Admin UI
         ✓ Wire Supabase Auth, middleware, login page
         ✓ Auto-create app_users trigger
         ✓ Build /admin/users (list + role toggle)
         ✓ Build /admin/upload (file upload + ingest invocation)
         ✓ Protect config drawer behind admin role
         ✓ Move config from localStorage → app_config table

Day 4  ─  Deploy + verify
         ✓ Push to GitHub, connect Railway
         ✓ Set env vars
         ✓ Migrate production data (run migrate-from-duckdb against live Supabase)
         ✓ Promote self to admin
         ✓ Create viewer accounts for team
         ✓ End-to-end smoke test
         ✓ CODEX review pass
```

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Migration ETL produces wrong aggregates (silent data corruption) | Spot-check 20 (city, date, metric) tuples old-vs-new before going live. Document in migration script output. |
| Free-tier Supabase paused after 7 days idle | Acceptable — 50 daily users prevent this. Document as known cold-start risk. |
| Concurrent ingest while user reading dashboard | Atomic L8D refresh transaction means readers see old-or-new, never torn. |
| Admin user locks themselves out (forgot password) | Day 1: manually reset via Supabase dashboard. Day 14+: add password reset flow. |
| Railway deploy fails mid-ship | Pre-validate against staging env (same Supabase free project, different Railway service). |
| The 14-CTE deletion accidentally changes a number users rely on | Spec'd in section 5 of original review. Spot-check critical metrics (overall DEL%, total riders, top-5 cities) before/after migration. Document in user-facing release notes if anything changes. |

---

## Acceptance Criteria

The migration is considered done when:

1. ✅ Every dashboard tab loads in <2 seconds end-to-end against Supabase
2. ✅ D-1 KPI cards load in <500ms (the hot path)
3. ✅ L8D trend tables load in <1 second
4. ✅ Login required for every page except `/login` and `/api/status`
5. ✅ Admin can change config in UI and the change persists across sessions
   for every user
6. ✅ Admin can invite a new viewer via `/admin/users`
7. ✅ Admin can upload CSVs via `/admin/upload`, see row counts and any drift
8. ✅ Spot-check: 20 (city, date, metric) values match between old DuckDB
   and new Postgres dashboard
9. ✅ No SQL queries longer than 50 lines in any API route (the 14-CTE
   problem is structurally impossible)
10. ✅ CODEX review of the changes passes without critical findings
