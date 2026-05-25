# rider_id TEXT → INTEGER Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate `rider_id` from TEXT to INTEGER in `rider_daily` and `rider_day_shipments`, update `ingest.js` to store integers, update the `classify_riders()` Postgres function and `v_current_classification` view, update TypeScript types, update `sql/schema.sql` to reflect final state, and verify the matrix data is accurate.

**Architecture:** Run a migration SQL file against Supabase (ALTER COLUMN TYPE with inline CAST), recreate the affected function and view with updated signatures, then update the JS/TS code layers. No temp columns needed — all rider IDs are confirmed numeric. Matrix verification runs the raw SQL and compares to frontend output.

**Tech Stack:** PostgreSQL 15 (Supabase), Node.js 20, Next.js (App Router), TypeScript, `pg` driver

---

## File Map

| File | Action | What changes |
|------|--------|--------------|
| `sql/migrate_rider_id_int.sql` | **Create** | One-shot migration: audit, ALTER COLUMN, recreate function + view |
| `sql/schema.sql` | **Modify** | Update column types + function/view definitions to match post-migration state |
| `backend/ingest.js` | **Modify** | `parseInt` rider_id in both `ingestRiderDaily` and `ingestSddCsv` |
| `lib/types.ts` | **Modify** | `riderId: string` → `riderId: number` in `RiderProfile` and `RiderDetail` |
| `app/api/profiling/route.ts` | **Modify** | `String(r.rider_id)` → `Number(r.rider_id)` in riders map |

---

## Task 1: Write the migration SQL file

**Files:**
- Create: `sql/migrate_rider_id_int.sql`

- [ ] **Step 1: Create the migration file**

Create `sql/migrate_rider_id_int.sql` with the following content:

```sql
-- Prime Dashboard — Migrate rider_id from TEXT to INTEGER
-- Run ONCE against Supabase with:
--   psql "$DATABASE_URL" -f sql/migrate_rider_id_int.sql
-- Safe to re-run: the DO block checks if columns are already INT before altering.

-- ── Step 0: Audit — fail fast if any non-numeric IDs exist ───────────────────
DO $$
DECLARE
  bad_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO bad_count
  FROM rider_daily
  WHERE rider_id !~ '^\d+$';

  IF bad_count > 0 THEN
    RAISE EXCEPTION 'rider_daily has % non-numeric rider_id values — migration aborted', bad_count;
  END IF;

  SELECT COUNT(*) INTO bad_count
  FROM rider_day_shipments
  WHERE rider_id !~ '^\d+$';

  IF bad_count > 0 THEN
    RAISE EXCEPTION 'rider_day_shipments has % non-numeric rider_id values — migration aborted', bad_count;
  END IF;

  RAISE NOTICE 'Audit passed: all rider_id values are numeric.';
END $$;

-- ── Step 1: Drop indexes and PKs on rider_daily ───────────────────────────────
ALTER TABLE rider_daily DROP CONSTRAINT IF EXISTS rider_daily_pkey;
DROP INDEX IF EXISTS rider_daily_rider_idx;
DROP INDEX IF EXISTS rider_daily_hub_idx;
DROP INDEX IF EXISTS rider_daily_date_idx;

-- ── Step 2: Alter column type on rider_daily ──────────────────────────────────
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'rider_daily' AND column_name = 'rider_id') <> 'integer' THEN
    ALTER TABLE rider_daily
      ALTER COLUMN rider_id TYPE INTEGER USING rider_id::INTEGER;
    RAISE NOTICE 'rider_daily.rider_id converted to INTEGER.';
  ELSE
    RAISE NOTICE 'rider_daily.rider_id is already INTEGER, skipping.';
  END IF;
END $$;

-- ── Step 3: Restore PK and indexes on rider_daily ────────────────────────────
ALTER TABLE rider_daily ADD PRIMARY KEY (date, rider_id);
CREATE INDEX IF NOT EXISTS rider_daily_rider_idx ON rider_daily (rider_id, date DESC);
CREATE INDEX IF NOT EXISTS rider_daily_hub_idx   ON rider_daily (hub, date);
CREATE INDEX IF NOT EXISTS rider_daily_date_idx  ON rider_daily (date);

-- ── Step 4: Drop indexes and PK on rider_day_shipments ───────────────────────
ALTER TABLE rider_day_shipments DROP CONSTRAINT IF EXISTS rider_day_shipments_pkey;
DROP INDEX IF EXISTS rider_day_ship_date_hub_idx;
DROP INDEX IF EXISTS rider_day_ship_rider_idx;
DROP INDEX IF EXISTS rider_day_ship_date_idx;

-- ── Step 5: Alter column type on rider_day_shipments ─────────────────────────
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'rider_day_shipments' AND column_name = 'rider_id') <> 'integer' THEN
    ALTER TABLE rider_day_shipments
      ALTER COLUMN rider_id TYPE INTEGER USING rider_id::INTEGER;
    RAISE NOTICE 'rider_day_shipments.rider_id converted to INTEGER.';
  ELSE
    RAISE NOTICE 'rider_day_shipments.rider_id is already INTEGER, skipping.';
  END IF;
END $$;

-- ── Step 6: Restore PK and indexes on rider_day_shipments ────────────────────
ALTER TABLE rider_day_shipments ADD PRIMARY KEY (date, rider_id, hub);
CREATE INDEX IF NOT EXISTS rider_day_ship_date_hub_idx ON rider_day_shipments (date, hub);
CREATE INDEX IF NOT EXISTS rider_day_ship_rider_idx    ON rider_day_shipments (rider_id, date DESC);
CREATE INDEX IF NOT EXISTS rider_day_ship_date_idx     ON rider_day_shipments (date);

-- ── Step 7: Recreate classify_riders() with INTEGER rider_id ─────────────────
CREATE OR REPLACE FUNCTION classify_riders(
  p_window_days       INTEGER DEFAULT 30,
  p_new_rider_days    INTEGER DEFAULT 7,
  p_evening_threshold NUMERIC DEFAULT 80,
  p_cross_threshold   NUMERIC DEFAULT 70,
  p_regular_threshold NUMERIC DEFAULT 80
) RETURNS TABLE (
  rider_id              INTEGER,
  rider_name            TEXT,
  hub                   TEXT,
  city                  TEXT,
  zone                  TEXT,
  pod_name              TEXT,
  total_days            INTEGER,
  login_days            INTEGER,
  morning_login_days    INTEGER,
  evening_login_days    INTEGER,
  login_rate_pct        NUMERIC,
  evening_login_rate_pct NUMERIC,
  first_ever_login      DATE,
  active_since_days     INTEGER,
  login_behaviour_tag   TEXT,
  regularity_tag        TEXT
)
LANGUAGE SQL STABLE
AS $$
  WITH anchor AS (
    SELECT anchor_date FROM data_anchor WHERE id = 1
  ),
  win AS (
    SELECT
      anchor_date,
      (anchor_date - (p_window_days - 1) * INTERVAL '1 day')::DATE AS start_date
    FROM anchor
  ),
  daily AS (
    SELECT
      rd.rider_id,
      MAX(rd.rider_name)  AS rider_name,
      MAX(rd.hub)         AS hub,
      COUNT(*)::INTEGER   AS login_days,
      SUM(CASE WHEN rd.morning_runsheet_hour IS NOT NULL THEN 1 ELSE 0 END)::INTEGER AS morning_login_days,
      SUM(CASE WHEN rd.evening_runsheet_hour IS NOT NULL THEN 1 ELSE 0 END)::INTEGER AS evening_login_days
    FROM rider_daily rd, win
    WHERE rd.date BETWEEN win.start_date AND win.anchor_date
    GROUP BY rd.rider_id
  ),
  global_first AS (
    SELECT rider_id, MIN(date) AS first_ever_login
    FROM rider_daily
    GROUP BY rider_id
  )
  SELECT
    d.rider_id,
    d.rider_name,
    d.hub,
    hm.city,
    hm.zone,
    hm.pod_name,
    p_window_days AS total_days,
    d.login_days,
    d.morning_login_days,
    d.evening_login_days,
    ROUND(d.login_days * 100.0 / p_window_days, 1) AS login_rate_pct,
    ROUND(d.evening_login_days * 100.0 / NULLIF(d.login_days, 0), 1) AS evening_login_rate_pct,
    gf.first_ever_login,
    (win.anchor_date - gf.first_ever_login)::INTEGER AS active_since_days,
    CASE
      WHEN d.morning_login_days = 0
       AND ROUND(d.evening_login_days * 100.0 / NULLIF(d.login_days, 0), 1) >= p_evening_threshold
      THEN 'Evening Rider'
      WHEN d.morning_login_days > 0
       AND ROUND(d.evening_login_days * 100.0 / NULLIF(d.login_days, 0), 1) >= p_cross_threshold
      THEN 'Cross Utilised'
      ELSE 'Morning Rider'
    END AS login_behaviour_tag,
    CASE
      WHEN (win.anchor_date - gf.first_ever_login) <= p_new_rider_days
        THEN 'New Rider'
      WHEN ROUND(d.login_days * 100.0 / p_window_days, 1) >= p_regular_threshold
        THEN 'Regular'
      ELSE 'Irregular'
    END AS regularity_tag
  FROM daily d
  JOIN global_first gf ON gf.rider_id = d.rider_id
  CROSS JOIN win
  LEFT JOIN hub_mapping hm ON hm.hub = d.hub;
$$;

-- ── Step 8: Recreate v_current_classification view ───────────────────────────
CREATE OR REPLACE VIEW v_current_classification AS
SELECT c.*
FROM app_config cfg,
LATERAL classify_riders(
  cfg.analysis_window_days,
  cfg.new_rider_window_days,
  cfg.evening_rider_threshold,
  cfg.cross_util_evening_threshold,
  cfg.regular_threshold
) c
WHERE cfg.id = 1;

-- ── Done ─────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  RAISE NOTICE 'Migration complete. rider_id is now INTEGER in rider_daily and rider_day_shipments.';
END $$;
```

- [ ] **Step 2: Commit the migration file**

```bash
cd "/Users/amalendu/Downloads/Sfx Workings/Claude Scripts/Prime Dashboard"
git add sql/migrate_rider_id_int.sql
git commit -m "migration: add rider_id TEXT→INT migration SQL"
```

---

## Task 2: Run the migration against Supabase

**Files:**
- No file changes — this runs SQL against the live DB

- [ ] **Step 1: Run the migration**

```bash
cd "/Users/amalendu/Downloads/Sfx Workings/Claude Scripts/Prime Dashboard"
psql "$DATABASE_URL" -f sql/migrate_rider_id_int.sql
```

Expected output (order may vary):
```
NOTICE:  Audit passed: all rider_id values are numeric.
NOTICE:  rider_daily.rider_id converted to INTEGER.
NOTICE:  rider_day_shipments.rider_id converted to INTEGER.
NOTICE:  Migration complete. rider_id is now INTEGER in rider_daily and rider_day_shipments.
```

If you see `EXCEPTION: ... non-numeric rider_id values`, stop — the audit caught bad data. Inspect with:
```sql
SELECT DISTINCT rider_id FROM rider_daily WHERE rider_id !~ '^\d+$' LIMIT 20;
```

- [ ] **Step 2: Verify column types in the DB**

```bash
psql "$DATABASE_URL" -c "\d rider_daily" | grep rider_id
psql "$DATABASE_URL" -c "\d rider_day_shipments" | grep rider_id
```

Expected output for each:
```
 rider_id  | integer | not null
```

---

## Task 3: Update sql/schema.sql to match post-migration state

**Files:**
- Modify: `sql/schema.sql`

`schema.sql` is the source of truth for a fresh deploy. Update it so `CREATE TABLE` statements and the function reflect the INTEGER type.

- [ ] **Step 1: Update rider_daily column definition**

In `sql/schema.sql`, find:
```sql
CREATE TABLE IF NOT EXISTS rider_daily (
  date                   DATE    NOT NULL,
  rider_id               TEXT    NOT NULL,
```

Replace with:
```sql
CREATE TABLE IF NOT EXISTS rider_daily (
  date                   DATE    NOT NULL,
  rider_id               INTEGER NOT NULL,
```

- [ ] **Step 2: Update rider_day_shipments column definition**

Find:
```sql
CREATE TABLE IF NOT EXISTS rider_day_shipments (
  date                  DATE    NOT NULL,
  rider_id              TEXT    NOT NULL,
```

Replace with:
```sql
CREATE TABLE IF NOT EXISTS rider_day_shipments (
  date                  DATE    NOT NULL,
  rider_id              INTEGER NOT NULL,
```

- [ ] **Step 3: Update classify_riders() return type in schema.sql**

Find (inside the `CREATE OR REPLACE FUNCTION classify_riders` block):
```sql
) RETURNS TABLE (
  rider_id              TEXT,
```

Replace with:
```sql
) RETURNS TABLE (
  rider_id              INTEGER,
```

- [ ] **Step 4: Commit schema.sql changes**

```bash
cd "/Users/amalendu/Downloads/Sfx Workings/Claude Scripts/Prime Dashboard"
git add sql/schema.sql
git commit -m "schema: update rider_id to INTEGER in schema.sql"
```

---

## Task 4: Update backend/ingest.js

**Files:**
- Modify: `backend/ingest.js`

Two places need changing: `ingestRiderDaily` (line ~94) and `ingestSddCsv` (line ~147).

- [ ] **Step 1: Update ingestRiderDaily — convert rider_id to int**

In `backend/ingest.js`, find this line inside the `params` flatMap in `ingestRiderDaily`:
```javascript
      r.date, r.rider_id, r.hub, r.rider_name || null,
```

Replace with:
```javascript
      r.date, parseInt(r.rider_id, 10), r.hub, r.rider_name || null,
```

- [ ] **Step 2: Update ingestSddCsv — convert rider_id to int**

In `backend/ingest.js`, find this line inside the `for (const r of rows)` loop in `ingestSddCsv`:
```javascript
    const riderId = (r.rider_id || '').trim()
```

Replace with:
```javascript
    const riderId = parseInt((r.rider_id || '').trim(), 10)
    if (isNaN(riderId)) continue
```

- [ ] **Step 3: Verify the riderDayMap key still works**

The key `${date}|${riderId}|${hub}` will now include the integer serialised as a string (e.g. `"2026-05-24|12345|BOM-001"`). This is fine — JS template literals coerce numbers to strings. No further change needed.

- [ ] **Step 4: Commit ingest.js changes**

```bash
cd "/Users/amalendu/Downloads/Sfx Workings/Claude Scripts/Prime Dashboard"
git add backend/ingest.js
git commit -m "ingest: parse rider_id as INTEGER before DB upsert"
```

---

## Task 5: Update TypeScript types

**Files:**
- Modify: `lib/types.ts`

`RiderProfile` and `RiderDetail` both have `riderId: string`. These are the types used by the frontend.

- [ ] **Step 1: Update RiderProfile.riderId**

In `lib/types.ts`, find:
```typescript
export interface RiderProfile {
  riderId: string
```

Replace with:
```typescript
export interface RiderProfile {
  riderId: number
```

- [ ] **Step 2: Update RiderDetail.riderId**

In `lib/types.ts`, find:
```typescript
export interface RiderDetail {
  riderId: string
```

Replace with:
```typescript
export interface RiderDetail {
  riderId: number
```

- [ ] **Step 3: Commit types**

```bash
cd "/Users/amalendu/Downloads/Sfx Workings/Claude Scripts/Prime Dashboard"
git add lib/types.ts
git commit -m "types: riderId string→number in RiderProfile and RiderDetail"
```

---

## Task 6: Update app/api/profiling/route.ts

**Files:**
- Modify: `app/api/profiling/route.ts`

The riders map at line 346 currently does `String(r.rider_id)`. After the DB column is INTEGER, the `pg` driver returns a JS `number`. Change the mapping to emit a number.

- [ ] **Step 1: Update riders map riderId**

In `app/api/profiling/route.ts`, find:
```typescript
      riders: riderRows.map(r => ({
        riderId: String(r.rider_id),
```

Replace with:
```typescript
      riders: riderRows.map(r => ({
        riderId: Number(r.rider_id),
```

- [ ] **Step 2: Commit route change**

```bash
cd "/Users/amalendu/Downloads/Sfx Workings/Claude Scripts/Prime Dashboard"
git add app/api/profiling/route.ts
git commit -m "api/profiling: emit riderId as number (post INT migration)"
```

---

## Task 6b: Update app/api/delivery/route.ts

**Files:**
- Modify: `app/api/delivery/route.ts`

Line 141 does `String(r.rider_id)` — change to `Number`.

- [ ] **Step 1: Update riderId mapping**

In `app/api/delivery/route.ts`, find:
```typescript
        riderId: String(r.rider_id),
        riderName: r.rider_name ?? '',
        hub: r.hub ?? '',
        city: r.city ?? '',
        behaviourTag: 'Morning Rider',
```

Replace with:
```typescript
        riderId: Number(r.rider_id),
        riderName: r.rider_name ?? '',
        hub: r.hub ?? '',
        city: r.city ?? '',
        behaviourTag: 'Morning Rider',
```

- [ ] **Step 2: Commit**

```bash
cd "/Users/amalendu/Downloads/Sfx Workings/Claude Scripts/Prime Dashboard"
git add app/api/delivery/route.ts
git commit -m "api/delivery: emit riderId as number"
```

---

## Task 6c: Update app/api/details/route.ts

**Files:**
- Modify: `app/api/details/route.ts`

Line 113 does `String(r.rider_id)` — change to `Number`.

- [ ] **Step 1: Update riderId mapping**

In `app/api/details/route.ts`, find:
```typescript
        riderId: String(r.rider_id),
        riderName: r.rider_name ?? '',
        hub: r.hub ?? '',
        city: r.city ?? '',
        loginBehaviourTag: 'Morning Rider',
```

Replace with:
```typescript
        riderId: Number(r.rider_id),
        riderName: r.rider_name ?? '',
        hub: r.hub ?? '',
        city: r.city ?? '',
        loginBehaviourTag: 'Morning Rider',
```

- [ ] **Step 2: Commit**

```bash
cd "/Users/amalendu/Downloads/Sfx Workings/Claude Scripts/Prime Dashboard"
git add app/api/details/route.ts
git commit -m "api/details: emit riderId as number"
```

---

## Task 6d: Update component inline prop types

**Files:**
- Modify: `components/rider-profile-card.tsx`
- Modify: `components/rider-drilldown.tsx`

Both components declare `riderId: string` in their inline prop interfaces. The URL param construction (`new URLSearchParams({ riderId: rider.riderId })`) requires a string — use `String(rider.riderId)` there.

- [ ] **Step 1: Update rider-profile-card.tsx**

In `components/rider-profile-card.tsx`, find:
```typescript
    riderId: string
```

Replace with:
```typescript
    riderId: number
```

Then find the URLSearchParams usage:
```typescript
    const params = new URLSearchParams({ riderId: rider.riderId })
```

Replace with:
```typescript
    const params = new URLSearchParams({ riderId: String(rider.riderId) })
```

- [ ] **Step 2: Update rider-drilldown.tsx**

In `components/rider-drilldown.tsx`, find the inline prop type:
```typescript
  rider: { riderId: string; riderName: string; hub: string; city: string; loginBehaviourTag: string; regularityTag: string }
```

Replace with:
```typescript
  rider: { riderId: number; riderName: string; hub: string; city: string; loginBehaviourTag: string; regularityTag: string }
```

The display `{rider.riderId}` will render as a number in JSX — that's fine, React renders numbers correctly. No other changes needed.

- [ ] **Step 3: Commit**

```bash
cd "/Users/amalendu/Downloads/Sfx Workings/Claude Scripts/Prime Dashboard"
git add components/rider-profile-card.tsx components/rider-drilldown.tsx
git commit -m "components: update riderId prop type to number"
```

---

## Task 7: TypeScript build check

**Files:**
- No changes — verification only

- [ ] **Step 1: Run tsc to catch any remaining string/number mismatches**

```bash
cd "/Users/amalendu/Downloads/Sfx Workings/Claude Scripts/Prime Dashboard"
npx tsc --noEmit 2>&1 | head -60
```

Expected: no errors. If you see errors mentioning `riderId`, they will point to components or other API routes that still use `riderId` as a string (e.g., using it in a string interpolation or comparing to `''`). Fix each by switching to `Number(...)` or updating the comparison.

Common fix pattern if a component does `rider.riderId.trim()` or similar:
- Change to `String(rider.riderId)` at the display layer if you need a string for rendering
- Or change the comparison to use `=== 0` instead of `=== ''`

- [ ] **Step 2: Commit any type fixes found**

```bash
git add -p
git commit -m "fix: resolve riderId type errors after int migration"
```

---

## Task 8: Matrix data verification

**Files:**
- No changes — read-only verification

This verifies the matrix data the frontend shows matches what the DB computes directly.

- [ ] **Step 1: Run the matrix SQL directly against the DB**

```bash
psql "$DATABASE_URL" -c "
SELECT regularity_tag, login_behaviour_tag, COUNT(*) AS n
FROM (
  SELECT
    rd.rider_id,
    CASE
      WHEN SUM(CASE WHEN morning_runsheet_hour IS NOT NULL THEN 1 ELSE 0 END) = 0
       AND ROUND(SUM(CASE WHEN evening_runsheet_hour IS NOT NULL THEN 1 ELSE 0 END)::NUMERIC * 100
           / NULLIF(COUNT(*), 0), 1) >= 80
      THEN 'Evening Rider'
      WHEN SUM(CASE WHEN morning_runsheet_hour IS NOT NULL THEN 1 ELSE 0 END) > 0
       AND ROUND(SUM(CASE WHEN evening_runsheet_hour IS NOT NULL THEN 1 ELSE 0 END)::NUMERIC * 100
           / NULLIF(COUNT(*), 0), 1) >= 70
      THEN 'Cross Utilised'
      ELSE 'Morning Rider'
    END AS login_behaviour_tag,
    CASE
      WHEN ((SELECT anchor_date FROM data_anchor WHERE id=1) - MIN(first_login)) <= 7
      THEN 'New Rider'
      WHEN ROUND(COUNT(*)::NUMERIC * 100 / 30, 1) >= 80
      THEN 'Regular'
      ELSE 'Irregular'
    END AS regularity_tag
  FROM rider_daily rd
  CROSS JOIN (SELECT anchor_date FROM data_anchor WHERE id=1) a
  JOIN (
    SELECT rider_id, MIN(date) AS first_login FROM rider_daily GROUP BY rider_id
  ) gf ON gf.rider_id = rd.rider_id
  WHERE rd.date BETWEEN (a.anchor_date - 29) AND a.anchor_date
  GROUP BY rd.rider_id, gf.first_login, a.anchor_date
) classified
GROUP BY regularity_tag, login_behaviour_tag
ORDER BY regularity_tag, login_behaviour_tag;
"
```

- [ ] **Step 2: Load the dashboard and read the matrix values**

Open the dashboard in a browser (run `npm run dev` first if not running):
```bash
cd "/Users/amalendu/Downloads/Sfx Workings/Claude Scripts/Prime Dashboard"
npm run dev &
open http://localhost:3000
```

Navigate to the Rider Profile page and note the 9 matrix cell values (Regular/Irregular/New Rider × Evening/Cross/Morning).

- [ ] **Step 3: Compare DB output to frontend matrix**

The numbers from Step 1 and Step 2 should match. If they don't, the discrepancy is almost always one of:
- Different `analysis_window_days` config (frontend default is 30, verify in `/configuration` page)
- Frontend is cached (try `?t=<timestamp>` on the profiling API URL or restart dev server)
- The `anchor_date` differs from what the profiling API uses

To isolate, call the API directly and compare:
```bash
curl "http://localhost:3000/api/profiling?windowDays=30&newRiderDays=7&eveningThreshold=80&crossThreshold=70&regularThreshold=80" \
  | python3 -m json.tool | grep -A 20 '"matrix"'
```

- [ ] **Step 4: Document verification result**

If everything matches, add a note in the commit message. If there's a discrepancy, investigate before closing this task.

---

## Task 9: Final commit and cleanup

- [ ] **Step 1: Run full build to confirm no regressions**

```bash
cd "/Users/amalendu/Downloads/Sfx Workings/Claude Scripts/Prime Dashboard"
npm run build 2>&1 | tail -20
```

Expected: `✓ Compiled successfully` (or equivalent). No type errors.

- [ ] **Step 2: Create a summary commit if any loose changes remain**

```bash
git status
git add -p  # stage any remaining files
git commit -m "feat: complete rider_id INT migration and matrix verification"
```
