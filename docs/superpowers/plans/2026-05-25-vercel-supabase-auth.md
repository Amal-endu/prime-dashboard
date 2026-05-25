# Vercel + Supabase + Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace DuckDB with Supabase Postgres, add email/password login with role-based access, and deploy to Vercel.

**Architecture:** Next.js middleware guards all routes, redirecting unauthenticated users to `/login`. API routes use a direct Postgres connection (`pg` pool) via a `lib/supabase/sql.ts` wrapper — this lets all existing SQL queries run unchanged with only minor Postgres syntax fixes. The browser-side Supabase client handles auth only (sign in / sign out / session cookies via `@supabase/ssr`).

**Tech Stack:** `@supabase/supabase-js`, `@supabase/ssr`, `pg` (node-postgres), Next.js middleware, Vercel

---

## File Map

**New files:**
- `lib/supabase/browser.ts` — anon Supabase client for auth in browser
- `lib/supabase/server.ts` — server Supabase client for session reads in middleware/server components
- `lib/supabase/sql.ts` — `pg` Pool wrapper replacing `backend/db.ts`
- `middleware.ts` — session guard at project root
- `app/login/page.tsx` — login UI
- `app/login/actions.ts` — `signIn` / `signOut` server actions
- `.env.local` — local env vars (gitignored)
- `.env.example` — template for env vars (committed)

**Modified files:**
- `package.json` — add `@supabase/supabase-js`, `@supabase/ssr`, `pg`, `@types/pg`; remove `duckdb`
- `components/top-nav.tsx` — add sign-out button
- `app/api/profiling/route.ts` — swap `query` import to `lib/supabase/sql.ts`; fix DuckDB→Postgres syntax
- `app/api/profiling/matrix/route.ts` — same
- `app/api/profiling/volume-matrix/route.ts` — same
- `app/api/details/route.ts` — same
- `app/api/details/trend/route.ts` — same
- `app/api/delivery/route.ts` — same
- `app/api/demand/route.ts` — same
- `app/api/demand/trend/route.ts` — same
- `app/api/status/route.ts` — same
- `backend/ingest.js` — replace DuckDB with `pg` + `DATABASE_URL`

**Deleted files:**
- `backend/db.ts` — replaced by `lib/supabase/sql.ts`

---

## DuckDB → Postgres Syntax Changes (reference for all API route tasks)

Every API route that used `query()` from `backend/db` needs these fixes:

| DuckDB | Postgres |
|--------|----------|
| `?` placeholder | `$1`, `$2`, `$3` ... (positional) |
| `INTERVAL (n) DAY` | `INTERVAL '1 day' * n` or `($1 \|\| ' days')::INTERVAL` |
| `DATEDIFF('day', a, b)` | `(b - a)` (date subtraction returns integer days) |
| `HOUR(timestamp)` | `EXTRACT(HOUR FROM timestamp)` |
| `TRY_CAST(x AS TIMESTAMP)` | `x::TIMESTAMP` (wrap in try/catch at app level) |
| `::DOUBLE` | `::FLOAT` or `::NUMERIC` |
| `v_max_date` view | `data_anchor` table: `SELECT anchor_date FROM data_anchor WHERE id = 1` |
| `sdd_awbs` raw table | `hub_day_l8d`, `rider_day_shipments`, `client_day_shipments` pre-agg tables |
| `INSERT OR REPLACE` | `INSERT ... ON CONFLICT ... DO UPDATE` |

---

## Task 1: Install packages and remove DuckDB

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install Supabase and pg packages**

```bash
cd "/Users/amalendu/Downloads/Sfx Workings/Claude Scripts/Prime Dashboard"
npm install @supabase/supabase-js @supabase/ssr pg @types/pg
```

Expected: packages added to `node_modules/`, `package-lock.json` updated.

- [ ] **Step 2: Remove duckdb from package.json**

In `package.json`, remove the line:
```json
"duckdb": "^1.4.4",
```

Then run:
```bash
npm install
```

Expected: `node_modules/duckdb` removed. No errors.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: swap duckdb for supabase-ssr + pg"
```

---

## Task 2: Environment variables

**Files:**
- Create: `.env.local`
- Create: `.env.example`

- [ ] **Step 1: Create .env.example (committed to git)**

Create `.env.example`:
```
# Supabase project settings (get from Supabase dashboard → Settings → API)
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-public-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-secret-key>

# Direct Postgres connection (Supabase dashboard → Settings → Database → Connection string → URI)
DATABASE_URL=postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres
```

- [ ] **Step 2: Create .env.local with real values**

Create `.env.local` (never commit this — it's already in `.gitignore`):
```
NEXT_PUBLIC_SUPABASE_URL=<paste from Supabase dashboard>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<paste from Supabase dashboard>
SUPABASE_SERVICE_ROLE_KEY=<paste from Supabase dashboard>
DATABASE_URL=<paste connection string from Supabase dashboard>
```

> **Where to find these:** Supabase dashboard → your project → Settings → API (for URL + keys) and Settings → Database → Connection string (for DATABASE_URL — use "Transaction" mode pooler on port 6543 for serverless).

- [ ] **Step 3: Verify .gitignore has .env.local**

```bash
grep ".env.local" .gitignore
```

Expected output: `.env.local` (or `.env*.local`). If missing, add it.

- [ ] **Step 4: Commit .env.example only**

```bash
git add .env.example
git commit -m "chore: add env var template"
```

---

## Task 3: Supabase client files

**Files:**
- Create: `lib/supabase/browser.ts`
- Create: `lib/supabase/server.ts`
- Create: `lib/supabase/sql.ts`

- [ ] **Step 1: Create browser client**

Create `lib/supabase/browser.ts`:
```typescript
import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}
```

- [ ] **Step 2: Create server client**

Create `lib/supabase/server.ts`:
```typescript
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            )
          } catch {}
        },
      },
    },
  )
}
```

- [ ] **Step 3: Create sql.ts — Postgres query wrapper**

Create `lib/supabase/sql.ts`:
```typescript
import { Pool } from 'pg'

const globalForPg = globalThis as unknown as { __pgPool?: Pool }

function getPool(): Pool {
  if (!globalForPg.__pgPool) {
    globalForPg.__pgPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 5,
    })
  }
  return globalForPg.__pgPool
}

export async function query<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const pool = getPool()
  const result = await pool.query(sql, params)
  return result.rows as T[]
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd "/Users/amalendu/Downloads/Sfx Workings/Claude Scripts/Prime Dashboard"
npx tsc --noEmit
```

Expected: no errors on the new files.

- [ ] **Step 5: Commit**

```bash
git add lib/supabase/
git commit -m "feat: add Supabase browser/server clients and pg sql wrapper"
```

---

## Task 4: Next.js middleware (route protection)

**Files:**
- Create: `middleware.ts` (project root)

- [ ] **Step 1: Create middleware.ts**

Create `middleware.ts` at the project root (same level as `package.json`):
```typescript
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  const { data: { user } } = await supabase.auth.getUser()

  const isLoginPage = request.nextUrl.pathname.startsWith('/login')

  if (!user && !isLoginPage) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('next', request.nextUrl.pathname)
    return NextResponse.redirect(url)
  }

  if (user && isLoginPage) {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|shadowfax-logo.svg|.*\\.svg$).*)',
  ],
}
```

- [ ] **Step 2: Verify middleware is picked up**

```bash
npm run dev
```

Visit `http://localhost:3000` — should redirect to `http://localhost:3000/login` (404 is fine, the redirect proves middleware works). Stop dev server.

- [ ] **Step 3: Commit**

```bash
git add middleware.ts
git commit -m "feat: add route protection middleware"
```

---

## Task 5: Login page

**Files:**
- Create: `app/login/page.tsx`
- Create: `app/login/actions.ts`

- [ ] **Step 1: Create server actions**

Create `app/login/actions.ts`:
```typescript
'use server'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export async function signIn(formData: FormData) {
  const supabase = await createClient()
  const email = formData.get('email') as string
  const password = formData.get('password') as string

  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    return redirect(`/login?error=${encodeURIComponent(error.message)}`)
  }

  const next = formData.get('next') as string | null
  return redirect(next || '/')
}

export async function signOut() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  return redirect('/login')
}
```

- [ ] **Step 2: Create login page**

Create `app/login/page.tsx`:
```typescript
import { signIn } from './actions'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>
}) {
  const params = await searchParams
  const errorMsg = params.error
  const next = params.next || '/'

  return (
    <div style={{
      minHeight: '100vh',
      background: '#FAFBFD',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'Inter, sans-serif',
    }}>
      <div style={{
        background: '#ffffff',
        border: '1px solid #E2E8F0',
        borderRadius: '12px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.03)',
        padding: '40px 36px',
        width: '100%',
        maxWidth: '400px',
      }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/shadowfax-logo.svg" alt="Shadowfax" style={{ height: '36px', marginBottom: '12px' }} />
          <h1 style={{ fontSize: '18px', fontWeight: 600, color: '#1e293b', margin: 0 }}>
            Prime Dashboard
          </h1>
          <p style={{ fontSize: '13px', color: '#94a3b8', marginTop: '4px' }}>
            Sign in to continue
          </p>
        </div>

        {/* Error */}
        {errorMsg && (
          <div style={{
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: '6px',
            padding: '10px 12px',
            fontSize: '12px',
            color: '#dc2626',
            marginBottom: '16px',
          }}>
            {decodeURIComponent(errorMsg)}
          </div>
        )}

        {/* Form */}
        <form action={signIn}>
          <input type="hidden" name="next" value={next} />

          <div style={{ marginBottom: '16px' }}>
            <label style={{
              display: 'block',
              fontSize: '11px',
              fontWeight: 500,
              color: '#64748b',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginBottom: '6px',
            }}>
              Email address
            </label>
            <input
              type="email"
              name="email"
              placeholder="name@shadowfax.in"
              autoComplete="username"
              required
              style={{
                width: '100%',
                padding: '9px 12px',
                border: '1px solid #E2E8F0',
                borderRadius: '6px',
                fontSize: '13px',
                color: '#1e293b',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div style={{ marginBottom: '24px' }}>
            <label style={{
              display: 'block',
              fontSize: '11px',
              fontWeight: 500,
              color: '#64748b',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginBottom: '6px',
            }}>
              Password
            </label>
            <input
              type="password"
              name="password"
              placeholder="Enter your password"
              autoComplete="current-password"
              required
              style={{
                width: '100%',
                padding: '9px 12px',
                border: '1px solid #E2E8F0',
                borderRadius: '6px',
                fontSize: '13px',
                color: '#1e293b',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <button
            type="submit"
            style={{
              width: '100%',
              padding: '11px',
              background: 'linear-gradient(135deg, #FF6200, #E85800)',
              color: '#ffffff',
              border: 'none',
              borderRadius: '6px',
              fontSize: '14px',
              fontWeight: 600,
              cursor: 'pointer',
              letterSpacing: '0.01em',
            }}
          >
            Sign In
          </button>
        </form>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Verify dev server starts without errors**

```bash
npm run dev
```

Visit `http://localhost:3000/login`. Should render the login form with Shadowfax logo, email field, password field, orange Sign In button. Stop dev server.

- [ ] **Step 4: Commit**

```bash
git add app/login/
git commit -m "feat: add login page and signIn/signOut server actions"
```

---

## Task 6: Sign-out button in TopNav

**Files:**
- Modify: `components/top-nav.tsx`

- [ ] **Step 1: Read current TopNav**

Read `components/top-nav.tsx` to find where the gear/config icon is rendered (around the right side of the nav bar).

- [ ] **Step 2: Add sign-out form**

In `components/top-nav.tsx`, add this import at the top if not already present:
```typescript
import { signOut } from '@/app/login/actions'
```

Then find the rightmost nav element (the freshness chip / settings gear area) and add a sign-out button alongside it:
```tsx
<form action={signOut}>
  <button
    type="submit"
    className="btn-secondary"
    style={{ fontSize: '11px', padding: '4px 10px' }}
  >
    Sign out
  </button>
</form>
```

- [ ] **Step 3: Verify no TypeScript errors**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add components/top-nav.tsx
git commit -m "feat: add sign-out button to TopNav"
```

---

## Task 7: Apply Postgres schema to Supabase

**Files:** None (SQL run in Supabase dashboard)

- [ ] **Step 1: Open Supabase SQL editor**

Go to your Supabase project → SQL Editor → New query.

- [ ] **Step 2: Run schema.sql**

Copy the full contents of `sql/schema.sql` and paste into the editor. Click Run.

Expected: all tables created (`hub_mapping`, `cpo`, `prime_clients`, `rider_daily`, `rider_day_shipments`, `client_day_shipments`, `hub_day_l8d`, `data_anchor`, `ingest_log`, `app_config`, `app_users`). Function `classify_riders` created. View `v_current_classification` created. RLS policies applied.

- [ ] **Step 3: Verify tables exist**

In the SQL editor run:
```sql
SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;
```

Expected: 11 tables listed.

- [ ] **Step 4: Insert app_config defaults**

```sql
INSERT INTO app_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
```

---

## Task 8: Seed reference data into Supabase

**Files:**
- No code changes — data load only.

> These steps load the CSV reference files (`hub_mapping.csv`, `CPO.csv`, `prime_clients.csv`) into Supabase using `psql`. You need `DATABASE_URL` from `.env.local`.

- [ ] **Step 1: Load hub_mapping.csv**

```bash
cd "/Users/amalendu/Downloads/Sfx Workings/Claude Scripts/Prime Dashboard"
source .env.local 2>/dev/null || export $(grep -v '^#' .env.local | xargs)
psql "$DATABASE_URL" -c "\COPY hub_mapping(hub, pod_name, zone, city) FROM 'hub_mapping.csv' CSV HEADER"
```

Expected: `COPY N` where N = number of rows.

- [ ] **Step 2: Load CPO.csv**

Check column names in `CPO.csv`:
```bash
head -1 CPO.csv
```

Then load (adjust column list if header names differ):
```bash
psql "$DATABASE_URL" -c "\COPY cpo(city, base_pay, sdd_pay, total_pay) FROM 'CPO.csv' CSV HEADER"
```

- [ ] **Step 3: Load prime_clients.csv**

```bash
psql "$DATABASE_URL" -c "\COPY prime_clients(client_name) FROM 'prime_clients.csv' CSV HEADER"
```

- [ ] **Step 4: Verify row counts**

```bash
psql "$DATABASE_URL" -c "SELECT 'hub_mapping' AS t, COUNT(*) FROM hub_mapping UNION ALL SELECT 'cpo', COUNT(*) FROM cpo UNION ALL SELECT 'prime_clients', COUNT(*) FROM prime_clients;"
```

Expected: non-zero counts for all three tables.

---

## Task 9: Rewrite ingest.js for Postgres

**Files:**
- Modify: `backend/ingest.js`

The ingest script loads `raw_data.csv` (→ `rider_daily`) and SDD AWB CSVs (→ `rider_day_shipments`, `client_day_shipments`, `hub_day_l8d`). It must now write to Supabase via `pg`.

- [ ] **Step 1: Replace the entire ingest.js**

Replace `backend/ingest.js` with:

```javascript
#!/usr/bin/env node
/**
 * Prime Dashboard — Postgres Ingest Script
 * Loads raw_data.csv into rider_daily and SDD CSVs into pre-agg tables.
 * Run: node backend/ingest.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env.local') })
const { Pool } = require('pg')
const fs = require('fs')
const path = require('path')
const { parse } = require('csv-parse/sync')

const ROOT = path.join(__dirname, '..')
const RAW_DATA_PATH = process.env.RAW_DATA_PATH || path.join(ROOT, 'raw_data.csv')
const SDD_DIR = process.env.SDD_DATA_DIR || path.join(ROOT, 'SDD_Data', 'May')
const HUB_MAPPING_PATH = process.env.HUB_MAPPING_PATH || path.join(ROOT, 'hub_mapping.csv')
const CPO_PATH = process.env.CPO_PATH || path.join(ROOT, 'CPO.csv')
const PRIME_CLIENTS_PATH = process.env.PRIME_CLIENTS_PATH || path.join(ROOT, 'prime_clients.csv')
const MR3_CUTOFF = parseInt(process.env.MR3_CUTOFF_HOUR || '15', 10)

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 3,
})

async function query(sql, params = []) {
  const client = await pool.connect()
  try {
    const result = await client.query(sql, params)
    return result.rows
  } finally {
    client.release()
  }
}

async function ingestRiderDaily() {
  if (!fs.existsSync(RAW_DATA_PATH)) {
    console.log('raw_data.csv not found, skipping rider_daily ingest')
    return
  }
  console.log('Ingesting rider_daily from raw_data.csv...')
  const rows = parse(fs.readFileSync(RAW_DATA_PATH), { columns: true, skip_empty_lines: true })
  let inserted = 0
  for (const r of rows) {
    await query(`
      INSERT INTO rider_daily
        (date, rider_id, hub, rider_name, morning_runsheet_hour, evening_runsheet_hour,
         attempt_morning, attempt_evening, attempted_total)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (date, rider_id) DO UPDATE SET
        hub = EXCLUDED.hub,
        rider_name = EXCLUDED.rider_name,
        morning_runsheet_hour = EXCLUDED.morning_runsheet_hour,
        evening_runsheet_hour = EXCLUDED.evening_runsheet_hour,
        attempt_morning = EXCLUDED.attempt_morning,
        attempt_evening = EXCLUDED.attempt_evening,
        attempted_total = EXCLUDED.attempted_total
    `, [
      r.date,
      r.rider_id,
      r.hub,
      r.rider_name || null,
      r.morning_runsheet_hour ? parseInt(r.morning_runsheet_hour) : null,
      r.evening_runsheet_hour ? parseInt(r.evening_runsheet_hour) : null,
      parseInt(r.attempt_morning || '0'),
      parseInt(r.attempt_evening || '0'),
      parseInt(r.attempted_total || '0'),
    ])
    inserted++
  }
  console.log(`rider_daily: ${inserted} rows upserted`)
}

async function ingestSddCsv(filePath) {
  console.log(`Ingesting SDD file: ${path.basename(filePath)}`)
  const rows = parse(fs.readFileSync(filePath), { columns: true, skip_empty_lines: true })

  // Load prime clients set
  const pcRows = await query('SELECT client_name FROM prime_clients')
  const primeSet = new Set(pcRows.map(r => r.client_name.toLowerCase().trim()))

  // Load hub→city map
  const hmRows = await query('SELECT hub, city FROM hub_mapping')
  const hubCityMap = Object.fromEntries(hmRows.map(r => [r.hub.toLowerCase().trim(), r.city]))

  // Group by (date, rider_id, hub) for rider_day_shipments
  const riderDayMap = {}
  // Group by (date, client_name) for client_day_shipments
  const clientDayMap = {}

  for (const r of rows) {
    if (!r.ofd_time || !r.rider_id) continue

    const ofdTs = new Date(r.ofd_time)
    if (isNaN(ofdTs.getTime())) continue
    const date = ofdTs.toISOString().slice(0, 10)

    const hub = (r.hub || '').trim()
    const riderId = (r.rider_id || '').trim()
    const clientName = (r.client_name || '').trim()

    const receivedTs = r.received_at_hub_time ? new Date(r.received_at_hub_time) : null
    const is3mr = receivedTs && !isNaN(receivedTs.getTime())
      ? receivedTs.getHours() >= MR3_CUTOFF
      : false

    const isDelivered = r.latest_status === 'DELIVERED'
    const isAttempted = ['DELIVERED', 'CID', 'NOT_CONTACTABLE'].includes(r.latest_status)
    const isBreach = ['true', '1', 'yes'].includes((r.breach || '').toLowerCase())

    // rider_day_shipments
    const rKey = `${date}|${riderId}|${hub}`
    if (!riderDayMap[rKey]) riderDayMap[rKey] = {
      date, rider_id: riderId, hub,
      assigned_3mr: 0, attempted_3mr: 0, delivered_3mr: 0, breach_count_3mr: 0,
      assigned_overall: 0, attempted_overall: 0, delivered_overall: 0, breach_count_overall: 0,
    }
    const rd = riderDayMap[rKey]
    rd.assigned_overall++
    if (isAttempted) rd.attempted_overall++
    if (isDelivered) rd.delivered_overall++
    if (isBreach) rd.breach_count_overall++
    if (is3mr) {
      rd.assigned_3mr++
      if (isAttempted) rd.attempted_3mr++
      if (isDelivered) rd.delivered_3mr++
      if (isBreach) rd.breach_count_3mr++
    }

    // client_day_shipments
    if (clientName) {
      const cKey = `${date}|${clientName}`
      const isPrime = primeSet.has(clientName.toLowerCase())
      if (!clientDayMap[cKey]) clientDayMap[cKey] = {
        date, client_name: clientName, is_prime: isPrime,
        awbs_3mr: 0, delivered_3mr: 0, awbs_overall: 0, delivered_overall: 0,
      }
      const cd = clientDayMap[cKey]
      cd.awbs_overall++
      if (isDelivered) cd.delivered_overall++
      if (is3mr) {
        cd.awbs_3mr++
        if (isDelivered) cd.delivered_3mr++
      }
    }
  }

  // Upsert rider_day_shipments
  for (const rd of Object.values(riderDayMap)) {
    await query(`
      INSERT INTO rider_day_shipments
        (date, rider_id, hub, assigned_3mr, attempted_3mr, delivered_3mr, breach_count_3mr,
         assigned_overall, attempted_overall, delivered_overall, breach_count_overall)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      ON CONFLICT (date, rider_id, hub) DO UPDATE SET
        assigned_3mr = EXCLUDED.assigned_3mr,
        attempted_3mr = EXCLUDED.attempted_3mr,
        delivered_3mr = EXCLUDED.delivered_3mr,
        breach_count_3mr = EXCLUDED.breach_count_3mr,
        assigned_overall = EXCLUDED.assigned_overall,
        attempted_overall = EXCLUDED.attempted_overall,
        delivered_overall = EXCLUDED.delivered_overall,
        breach_count_overall = EXCLUDED.breach_count_overall
    `, [rd.date, rd.rider_id, rd.hub, rd.assigned_3mr, rd.attempted_3mr, rd.delivered_3mr,
        rd.breach_count_3mr, rd.assigned_overall, rd.attempted_overall, rd.delivered_overall,
        rd.breach_count_overall])
  }

  // Upsert client_day_shipments
  for (const cd of Object.values(clientDayMap)) {
    await query(`
      INSERT INTO client_day_shipments
        (date, client_name, is_prime, awbs_3mr, delivered_3mr, awbs_overall, delivered_overall)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (date, client_name) DO UPDATE SET
        is_prime = EXCLUDED.is_prime,
        awbs_3mr = EXCLUDED.awbs_3mr,
        delivered_3mr = EXCLUDED.delivered_3mr,
        awbs_overall = EXCLUDED.awbs_overall,
        delivered_overall = EXCLUDED.delivered_overall
    `, [cd.date, cd.client_name, cd.is_prime, cd.awbs_3mr, cd.delivered_3mr, cd.awbs_overall, cd.delivered_overall])
  }

  console.log(`  rider_day_shipments: ${Object.keys(riderDayMap).length} rows`)
  console.log(`  client_day_shipments: ${Object.keys(clientDayMap).length} rows`)
}

async function refreshHubDayL8d() {
  console.log('Refreshing hub_day_l8d...')
  await query(`
    INSERT INTO hub_day_l8d
      (date, hub, city, zone,
       riders_active,
       assigned_3mr, attempted_3mr, delivered_3mr, breach_count_3mr,
       assigned_overall, attempted_overall, delivered_overall, breach_count_overall)
    SELECT
      s.date,
      s.hub,
      COALESCE(hm.city, 'Unmapped') AS city,
      hm.zone,
      COUNT(DISTINCT s.rider_id)    AS riders_active,
      SUM(s.assigned_3mr),
      SUM(s.attempted_3mr),
      SUM(s.delivered_3mr),
      SUM(s.breach_count_3mr),
      SUM(s.assigned_overall),
      SUM(s.attempted_overall),
      SUM(s.delivered_overall),
      SUM(s.breach_count_overall)
    FROM rider_day_shipments s
    LEFT JOIN hub_mapping hm ON LOWER(s.hub) = LOWER(hm.hub)
    WHERE s.date >= CURRENT_DATE - INTERVAL '8 days'
    GROUP BY s.date, s.hub, hm.city, hm.zone
    ON CONFLICT (date, hub) DO UPDATE SET
      city = EXCLUDED.city,
      zone = EXCLUDED.zone,
      riders_active = EXCLUDED.riders_active,
      assigned_3mr = EXCLUDED.assigned_3mr,
      attempted_3mr = EXCLUDED.attempted_3mr,
      delivered_3mr = EXCLUDED.delivered_3mr,
      breach_count_3mr = EXCLUDED.breach_count_3mr,
      assigned_overall = EXCLUDED.assigned_overall,
      attempted_overall = EXCLUDED.attempted_overall,
      delivered_overall = EXCLUDED.delivered_overall,
      breach_count_overall = EXCLUDED.breach_count_overall
  `)
  console.log('hub_day_l8d refreshed')
}

async function updateDataAnchor() {
  const [{ rd_max }] = await query('SELECT MAX(date)::TEXT AS rd_max FROM rider_daily')
  const [{ sh_max }] = await query('SELECT MAX(date)::TEXT AS sh_max FROM rider_day_shipments')
  if (!rd_max || !sh_max) { console.log('No data yet, skipping anchor update'); return }
  await query(`
    INSERT INTO data_anchor (id, rider_daily_max, shipments_max, updated_at)
    VALUES (1, $1, $2, NOW())
    ON CONFLICT (id) DO UPDATE SET
      rider_daily_max = EXCLUDED.rider_daily_max,
      shipments_max = EXCLUDED.shipments_max,
      updated_at = NOW()
  `, [rd_max, sh_max])
  console.log(`data_anchor updated: rider_daily=${rd_max}, shipments=${sh_max}`)
}

async function main() {
  const force = process.argv.includes('--force')
  try {
    await ingestRiderDaily()

    if (fs.existsSync(SDD_DIR)) {
      const files = fs.readdirSync(SDD_DIR)
        .filter(f => f.endsWith('.csv'))
        .map(f => path.join(SDD_DIR, f))

      for (const file of files) {
        const filename = path.basename(file)
        if (!force) {
          const [existing] = await query('SELECT filename FROM ingest_log WHERE filename = $1', [filename])
          if (existing) { console.log(`Skipping ${filename} (already ingested)`); continue }
        }
        await ingestSddCsv(file)
        await query(`
          INSERT INTO ingest_log (filename, ingested_at, row_count)
          VALUES ($1, NOW(), 0)
          ON CONFLICT (filename) DO UPDATE SET ingested_at = NOW()
        `, [filename])
      }
    } else {
      console.log(`SDD_Data dir not found at ${SDD_DIR}, skipping AWB ingest`)
    }

    await refreshHubDayL8d()
    await updateDataAnchor()
    console.log('Ingest complete.')
  } finally {
    await pool.end()
  }
}

main().catch(e => { console.error(e); process.exit(1) })
```

- [ ] **Step 2: Install csv-parse**

```bash
npm install csv-parse
```

- [ ] **Step 3: Test dry run (no SDD data needed)**

```bash
node backend/ingest.js
```

Expected: script connects to Supabase, processes `raw_data.csv` if present, prints `Ingest complete.`. No crash.

- [ ] **Step 4: Commit**

```bash
git add backend/ingest.js package.json package-lock.json
git commit -m "feat: rewrite ingest.js for Postgres/Supabase"
```

---

## Task 10: Update API route — /api/status

**Files:**
- Modify: `app/api/status/route.ts`

- [ ] **Step 1: Read current file**

Read `app/api/status/route.ts`.

- [ ] **Step 2: Replace db import and query**

Replace the `query` import from `@/backend/db` with:
```typescript
import { query } from '@/lib/supabase/sql'
```

Find where `v_max_date` is queried and replace with:
```typescript
const rows = await query<{ anchor_date: string; updated_at: string }>(
  'SELECT anchor_date::TEXT AS anchor_date, updated_at FROM data_anchor WHERE id = 1'
)
```

Adjust the response shape to use `anchor_date` instead of `max_date`.

- [ ] **Step 3: Commit**

```bash
git add app/api/status/route.ts
git commit -m "fix: status route — use data_anchor instead of v_max_date"
```

---

## Task 11: Update API route — /api/profiling/matrix

**Files:**
- Modify: `app/api/profiling/matrix/route.ts`

- [ ] **Step 1: Replace import**

Change line 4:
```typescript
import { query } from '@/backend/db'
```
to:
```typescript
import { query } from '@/lib/supabase/sql'
```

- [ ] **Step 2: Fix SQL syntax throughout the file**

The `classifyCte` string uses DuckDB syntax. Replace the entire classifyCte with the Postgres version. Find the block that starts with `const classifyCte = \`` and replace it with:

```typescript
const classifyCte = `
cfg AS (
  SELECT
    $1::INTEGER AS window_days,
    $2::INTEGER AS new_rider_days,
    $3::FLOAT   AS evening_threshold,
    $4::FLOAT   AS cross_threshold,
    $5::FLOAT   AS regular_threshold
),
anchor AS (SELECT anchor_date FROM data_anchor WHERE id = 1),
rider_window AS (
  SELECT
    rd.rider_id, rd.rider_name, rd.hub, rd.date,
    CASE WHEN rd.morning_runsheet_hour IS NOT NULL THEN 1 ELSE 0 END AS had_morning_login,
    CASE WHEN rd.evening_runsheet_hour IS NOT NULL THEN 1 ELSE 0 END AS had_evening_login,
    1 AS had_any_login
  FROM rider_daily rd, anchor, cfg
  WHERE rd.date BETWEEN (anchor.anchor_date - (cfg.window_days - 1) * INTERVAL '1 day')::DATE
                    AND anchor.anchor_date
),
agg AS (
  SELECT
    rider_id, MAX(rider_name) AS rider_name, MAX(hub) AS hub,
    (SELECT window_days FROM cfg) AS total_days,
    SUM(had_any_login) AS login_days,
    SUM(had_morning_login) AS morning_login_days,
    SUM(had_evening_login) AS evening_login_days,
    ROUND(SUM(had_any_login) * 100.0 / (SELECT window_days FROM cfg), 1) AS login_rate_pct,
    ROUND(SUM(had_evening_login) * 100.0 / NULLIF(SUM(had_any_login), 0), 1) AS evening_login_rate_pct
  FROM rider_window GROUP BY rider_id
),
global_first AS (
  SELECT rider_id, MIN(date) AS first_ever_login FROM rider_daily GROUP BY rider_id
),
classified AS (
  SELECT a.*, gf.first_ever_login,
    (SELECT anchor_date FROM anchor) AS max_date,
    ((SELECT anchor_date FROM anchor) - gf.first_ever_login) AS active_since_days,
    CASE
      WHEN ((SELECT anchor_date FROM anchor) - gf.first_ever_login) <= (SELECT new_rider_days FROM cfg) THEN TRUE
      ELSE FALSE
    END AS is_new_rider,
    CASE
      WHEN morning_login_days = 0 AND evening_login_rate_pct >= (SELECT evening_threshold FROM cfg) THEN 'Evening Rider'
      WHEN morning_login_days > 0 AND evening_login_rate_pct >= (SELECT cross_threshold FROM cfg) THEN 'Cross Utilised'
      ELSE 'Morning Rider'
    END AS login_behaviour_tag,
    CASE
      WHEN ((SELECT anchor_date FROM anchor) - gf.first_ever_login) <= (SELECT new_rider_days FROM cfg) THEN 'New Rider'
      WHEN login_rate_pct >= (SELECT regular_threshold FROM cfg) THEN 'Regular'
      ELSE 'Irregular'
    END AS regularity_tag
  FROM agg a JOIN global_first gf USING (rider_id)
),
rider_summary AS (
  SELECT c.*, hm.city, hm.zone, hm.pod_name
  FROM classified c LEFT JOIN hub_mapping hm ON LOWER(c.hub) = LOWER(hm.hub)
)`
```

- [ ] **Step 3: Fix placeholder numbering for city/hub filter queries**

The existing filter queries use `?` for city/hub. Change all `?` placeholders to positional `$N` where N continues from 6 onward (after the 5 cfg params). For the city list and hub list queries that use `v_rider_summary`, replace with direct queries from `rider_summary` CTE inside a WITH block, or use a separate query against `hub_mapping`:

Replace the `cityList` query:
```typescript
const cityList = await query<{ city: string }>(
  'SELECT DISTINCT city FROM hub_mapping WHERE city IS NOT NULL ORDER BY city'
)
```

Replace the `hubList` query:
```typescript
const hubList = city
  ? await query<{ hub: string }>(
      'SELECT DISTINCT hub FROM hub_mapping WHERE city = $1 ORDER BY hub',
      [city],
    )
  : await query<{ hub: string }>('SELECT DISTINCT hub FROM hub_mapping ORDER BY hub')
```

For the matrix query that uses the CTE with city/hub filters — build the WHERE clause with `$6`, `$7` etc. continuing the parameter numbering:
```typescript
const filterParams: unknown[] = []
let where = `WHERE 1=1${d1Where}`
let paramIdx = 6
if (city) { where += ` AND COALESCE(city, 'Unmapped') = $${paramIdx++}`; filterParams.push(city) }
if (hub)  { where += ` AND hub = $${paramIdx++}`;                        filterParams.push(hub) }
```

Pass `[...cfgParams, ...filterParams]` to all queries using the CTE.

- [ ] **Step 4: Remove the d1Cte block** (references `sdd_awbs` which no longer exists)

Find the `const d1Cte` block and replace with:
```typescript
const d1Cte = ''
const d1Where = ''
```

(The D-1 filter feature can be restored later once `rider_day_shipments` is used properly.)

- [ ] **Step 5: Verify TypeScript**

```bash
npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add app/api/profiling/matrix/route.ts
git commit -m "fix: profiling/matrix — DuckDB→Postgres SQL syntax"
```

---

## Task 12: Update API route — /api/profiling (main)

**Files:**
- Modify: `app/api/profiling/route.ts`

- [ ] **Step 1: Replace import**

Change:
```typescript
import { query } from '@/backend/db'
```
to:
```typescript
import { query } from '@/lib/supabase/sql'
```

- [ ] **Step 2: Replace classifyCte**

Replace the entire `const classifyCte = \`` block (same Postgres version as Task 11 Step 2). The `cfgParams` are `[$1..$5]`.

- [ ] **Step 3: Replace avgDailyCte placeholder**

In `avgDailyCte`, the window is passed as an additional param. Change the DuckDB param:
```sql
WHERE rd.date BETWEEN (mx.max_date - INTERVAL (?::INTEGER - 1) DAY) AND mx.max_date
```
to use the anchor and a numbered param. Since `cfgParams` uses `$1..$5`, the window days in `avgDailyCte` re-uses `$1` (same value). Change the `avgDailyCte` reference to use `(SELECT window_days FROM cfg)` instead of a separate `?`:

```sql
WHERE rd.date BETWEEN (anchor.anchor_date - ((SELECT window_days FROM cfg) - 1) * INTERVAL '1 day')::DATE
                  AND anchor.anchor_date
```

And add `anchor` to the FROM clause: `FROM rider_daily rd, anchor`.

Remove the extra `windowDays` param that was appended separately — the CTE already has `$1` for window_days.

- [ ] **Step 4: Fix all `?` placeholders to `$N`**

Search for every `?` in the file and replace with the correct positional `$N`. The `behaviourClause` and `regularityClause` filters start at `$6`, `$7` (or wherever filter params begin after cfgParams).

- [ ] **Step 5: Fix `::DOUBLE` → `::FLOAT`**

```bash
sed -i '' 's/::DOUBLE/::FLOAT/g' app/api/profiling/route.ts
```

- [ ] **Step 6: Verify TypeScript**

```bash
npx tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
git add app/api/profiling/route.ts
git commit -m "fix: profiling route — DuckDB→Postgres SQL syntax"
```

---

## Task 13: Update API route — /api/profiling/volume-matrix

**Files:**
- Modify: `app/api/profiling/volume-matrix/route.ts`

- [ ] **Step 1: Read the file**

Read `app/api/profiling/volume-matrix/route.ts`.

- [ ] **Step 2: Replace import and fix SQL**

Apply the same changes as Tasks 11–12:
- Replace `import { query } from '@/backend/db'` → `@/lib/supabase/sql`
- Replace `?` with `$N` positional params
- Replace `INTERVAL (n) DAY` → `n * INTERVAL '1 day'`
- Replace `DATEDIFF('day', a, b)` → `(b - a)`
- Replace `v_max_date` → `data_anchor WHERE id = 1`, field `anchor_date`
- Replace `::DOUBLE` → `::FLOAT`

- [ ] **Step 3: Verify TypeScript**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add app/api/profiling/volume-matrix/route.ts
git commit -m "fix: profiling/volume-matrix — DuckDB→Postgres SQL syntax"
```

---

## Task 14: Update API routes — /api/details and /api/details/trend

**Files:**
- Modify: `app/api/details/route.ts`
- Modify: `app/api/details/trend/route.ts`

These routes query `sdd_awbs` (which is replaced by `hub_day_l8d` and `rider_day_shipments`).

- [ ] **Step 1: Read both files**

Read `app/api/details/route.ts` and `app/api/details/trend/route.ts`.

- [ ] **Step 2: Replace import in both files**

```typescript
import { query } from '@/lib/supabase/sql'
```

- [ ] **Step 3: Rewrite details/trend route to use hub_day_l8d**

The trend route builds 8-day city/hub tables for riders, productivity, earnings, DEL%. Replace the `sdd_awbs` scan with `hub_day_l8d` + `rider_day_shipments`.

Replace the `buildCityDayQuery` function with a query against `hub_day_l8d`:

```typescript
function buildCityDayQuery(mode: '3mr' | 'overall', dates: string[]): string {
  const col = mode === 'overall' ? 'overall' : '3mr'
  const placeholders = dates.map((_, i) => `$${i + 1}`).join(',')
  return `
    SELECT
      h.city,
      h.date::TEXT AS date,
      SUM(h.riders_active) AS riders,
      ROUND(SUM(h.attempted_${col})::FLOAT / NULLIF(SUM(h.riders_active), 0), 1) AS avg_productivity,
      ROUND(SUM(h.delivered_${col})::FLOAT * COALESCE(MAX(c.total_pay), 0) / NULLIF(SUM(h.riders_active), 0), 0) AS avg_earnings,
      ROUND(SUM(h.delivered_${col})::FLOAT / NULLIF(SUM(h.assigned_${col}), 0) * 100, 1) AS del_pct
    FROM hub_day_l8d h
    LEFT JOIN cpo c ON h.city = c.city
    WHERE h.date IN (${placeholders})
    GROUP BY h.city, h.date
    ORDER BY h.city, h.date
  `
}
```

And a hub-level version:
```typescript
function buildHubDayQuery(mode: '3mr' | 'overall', dates: string[]): string {
  const col = mode === 'overall' ? 'overall' : '3mr'
  const placeholders = dates.map((_, i) => `$${i + 1}`).join(',')
  return `
    SELECT
      h.hub,
      h.city,
      h.date::TEXT AS date,
      h.riders_active AS riders,
      ROUND(h.attempted_${col}::FLOAT / NULLIF(h.riders_active, 0), 1) AS avg_productivity,
      ROUND(h.delivered_${col}::FLOAT * COALESCE(c.total_pay, 0) / NULLIF(h.riders_active, 0), 0) AS avg_earnings,
      ROUND(h.delivered_${col}::FLOAT / NULLIF(h.assigned_${col}, 0) * 100, 1) AS del_pct
    FROM hub_day_l8d h
    LEFT JOIN cpo c ON h.city = c.city
    WHERE h.date IN (${placeholders})
    ORDER BY h.city, h.hub, h.date
  `
}
```

Replace the `v_max_date` call with:
```typescript
const [anchor] = await query<{ anchor_date: string }>(
  'SELECT anchor_date::TEXT AS anchor_date FROM data_anchor WHERE id = 1'
)
const maxDate = new Date(anchor.anchor_date)
```

- [ ] **Step 4: Fix details/route.ts similarly**

`/api/details` returns the same data for a single date. Rewrite to query `hub_day_l8d` for the requested date range, replacing `sdd_awbs` scans.

- [ ] **Step 5: Verify TypeScript**

```bash
npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add app/api/details/route.ts app/api/details/trend/route.ts
git commit -m "fix: details routes — rewrite from sdd_awbs to hub_day_l8d"
```

---

## Task 15: Update API routes — /api/delivery

**Files:**
- Modify: `app/api/delivery/route.ts`

- [ ] **Step 1: Read the file**

Read `app/api/delivery/route.ts`.

- [ ] **Step 2: Replace import**

```typescript
import { query } from '@/lib/supabase/sql'
```

- [ ] **Step 3: Replace sdd_awbs queries with rider_day_shipments + hub_day_l8d**

The delivery route returns rider-level DEL%, breach counts, hub and city rollups. Replace the raw `sdd_awbs` + classification CTE with:

```typescript
// City-level rollup
const cityRows = await query<Record<string, unknown>>(`
  SELECT
    h.city,
    SUM(h.assigned_3mr) AS orders_3mr,
    SUM(h.delivered_3mr) AS delivered_3mr,
    ROUND(SUM(h.delivered_3mr)::FLOAT / NULLIF(SUM(h.assigned_3mr), 0) * 100, 1) AS del_pct,
    SUM(h.breach_count_3mr) AS breach_count
  FROM hub_day_l8d h
  WHERE h.date BETWEEN $1 AND $2
  GROUP BY h.city
  ORDER BY h.city
`, [startDate, endDate])

// Hub-level rollup
const hubRows = await query<Record<string, unknown>>(`
  SELECT
    h.hub, h.city,
    SUM(h.assigned_3mr) AS orders_3mr,
    SUM(h.delivered_3mr) AS delivered_3mr,
    ROUND(SUM(h.delivered_3mr)::FLOAT / NULLIF(SUM(h.assigned_3mr), 0) * 100, 1) AS del_pct,
    SUM(h.breach_count_3mr) AS breach_count
  FROM hub_day_l8d h
  WHERE h.date BETWEEN $1 AND $2
  GROUP BY h.hub, h.city
  ORDER BY h.city, h.hub
`, [startDate, endDate])

// Rider-level
const riderRows = await query<Record<string, unknown>>(`
  SELECT
    s.rider_id,
    MAX(rd.rider_name) AS rider_name,
    s.hub,
    COALESCE(hm.city, 'Unmapped') AS city,
    SUM(s.assigned_3mr) AS orders_3mr,
    SUM(s.delivered_3mr) AS delivered_3mr,
    ROUND(SUM(s.delivered_3mr)::FLOAT / NULLIF(SUM(s.assigned_3mr), 0) * 100, 1) AS del_pct,
    SUM(s.breach_count_3mr) AS breach_count
  FROM rider_day_shipments s
  LEFT JOIN hub_mapping hm ON LOWER(s.hub) = LOWER(hm.hub)
  LEFT JOIN rider_daily rd ON rd.rider_id = s.rider_id AND rd.date = s.date
  WHERE s.date BETWEEN $1 AND $2
  GROUP BY s.rider_id, s.hub, hm.city
  ORDER BY city, s.hub, s.rider_id
`, [startDate, endDate])
```

Replace the `v_max_date` / date range resolution to use `data_anchor`:
```typescript
const [anchor] = await query<{ anchor_date: string }>(
  'SELECT anchor_date::TEXT AS anchor_date FROM data_anchor WHERE id = 1'
)
const maxDate = new Date(anchor.anchor_date)
const { startDate, endDate } = resolveDateRange(datePreset, maxDate)
```

- [ ] **Step 4: Verify TypeScript**

```bash
npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add app/api/delivery/route.ts
git commit -m "fix: delivery route — rewrite from sdd_awbs to rider_day_shipments + hub_day_l8d"
```

---

## Task 16: Update API routes — /api/demand and /api/demand/trend

**Files:**
- Modify: `app/api/demand/route.ts`
- Modify: `app/api/demand/trend/route.ts`

- [ ] **Step 1: Read both files**

Read `app/api/demand/route.ts` and `app/api/demand/trend/route.ts`.

- [ ] **Step 2: Replace import in both files**

```typescript
import { query } from '@/lib/supabase/sql'
```

- [ ] **Step 3: Rewrite demand/route.ts — city view**

Replace `sdd_awbs` city-level query with `hub_day_l8d`:
```typescript
const cityRows = await query<Record<string, unknown>>(`
  SELECT
    h.city,
    SUM(h.assigned_overall) AS total_demand,
    SUM(h.assigned_3mr) AS demand_3mr,
    ROUND(SUM(h.delivered_3mr)::FLOAT / NULLIF(SUM(h.assigned_3mr), 0) * 100, 1) AS del_pct_3mr
  FROM hub_day_l8d h
  WHERE h.date = $1
  GROUP BY h.city
  ORDER BY total_demand DESC
`, [today])

const hubRows = await query<Record<string, unknown>>(`
  SELECT
    h.hub, h.city,
    SUM(h.assigned_overall) AS total_demand,
    SUM(h.assigned_3mr) AS demand_3mr,
    ROUND(SUM(h.delivered_3mr)::FLOAT / NULLIF(SUM(h.assigned_3mr), 0) * 100, 1) AS del_pct_3mr
  FROM hub_day_l8d h
  WHERE h.date = $1
  GROUP BY h.hub, h.city
  ORDER BY h.city, total_demand DESC
`, [today])
```

Replace `sdd_awbs` client-level query with `client_day_shipments`:
```typescript
const primeClause = primeOnly ? 'AND c.is_prime = TRUE' : ''
const clientRows = await query<Record<string, unknown>>(`
  SELECT
    c.client_name,
    c.is_prime,
    SUM(c.awbs_overall) AS total_awbs,
    SUM(c.awbs_3mr) AS awbs_3mr,
    SUM(c.delivered_3mr) AS delivered_3mr,
    ROUND(SUM(c.delivered_3mr)::FLOAT / NULLIF(SUM(c.awbs_3mr), 0) * 100, 1) AS del_pct
  FROM client_day_shipments c
  WHERE c.date = $1 ${primeClause}
  GROUP BY c.client_name, c.is_prime
  ORDER BY total_awbs DESC
`, [today])
```

Replace `v_max_date` with `data_anchor`:
```typescript
const [anchor] = await query<{ anchor_date: string }>(
  'SELECT anchor_date::TEXT AS anchor_date FROM data_anchor WHERE id = 1'
)
const today = anchor.anchor_date
```

- [ ] **Step 4: Rewrite demand/trend route**

Apply same pattern — replace `sdd_awbs` with `hub_day_l8d` for city/hub trends, `client_day_shipments` for client trends. Use `data_anchor` for dates.

- [ ] **Step 5: Fix all remaining `?` → `$N` in both files**

```bash
grep -n "?" app/api/demand/route.ts app/api/demand/trend/route.ts
```

Review each hit and assign the correct positional number.

- [ ] **Step 6: Verify TypeScript**

```bash
npx tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
git add app/api/demand/route.ts app/api/demand/trend/route.ts
git commit -m "fix: demand routes — rewrite from sdd_awbs to pre-agg tables"
```

---

## Task 17: Delete backend/db.ts

**Files:**
- Delete: `backend/db.ts`

- [ ] **Step 1: Verify no remaining imports from backend/db**

```bash
grep -r "from '@/backend/db'\|from \"@/backend/db\"" app/ components/ lib/
```

Expected: no output. If any hits remain, fix them first.

- [ ] **Step 2: Delete the file**

```bash
rm "/Users/amalendu/Downloads/Sfx Workings/Claude Scripts/Prime Dashboard/backend/db.ts"
```

- [ ] **Step 3: Verify build still compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove backend/db.ts (replaced by lib/supabase/sql.ts)"
```

---

## Task 18: Local end-to-end test

- [ ] **Step 1: Run ingest with real data**

```bash
node backend/ingest.js
```

Expected: rider_daily rows inserted, hub_day_l8d refreshed, data_anchor updated.

- [ ] **Step 2: Start dev server**

```bash
npm run dev
```

- [ ] **Step 3: Test login flow**

Visit `http://localhost:3000` — should redirect to `/login`. Create a test user in Supabase dashboard (Authentication → Users → Invite user). Enter credentials on login page. Should redirect to `/` (Rider Profile page).

- [ ] **Step 4: Test each page loads**

- `http://localhost:3000/` — Rider Profile
- `http://localhost:3000/rider-perf-trend` — Daily Perf
- `http://localhost:3000/rider-delivery` — Delivery
- `http://localhost:3000/demand` — Allocation

Each should load data without console errors.

- [ ] **Step 5: Test sign-out**

Click Sign out in TopNav → should redirect to `/login`.

---

## Task 19: Deploy to Vercel

- [ ] **Step 1: Push to GitHub**

```bash
git push origin main
```

- [ ] **Step 2: Import project in Vercel**

Go to vercel.com → New Project → Import from GitHub → select this repo.

Framework: Next.js (auto-detected). Build command: `npm run build`. Output: `.next`.

- [ ] **Step 3: Add environment variables in Vercel**

In Vercel project → Settings → Environment Variables, add all four:
```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
DATABASE_URL
```

Set all to apply to Production, Preview, and Development environments.

- [ ] **Step 4: Deploy**

Click Deploy. Wait for build to complete (~2 minutes).

Expected: build succeeds. Visit the Vercel URL — redirected to `/login`. Sign in with your Supabase user. Dashboard loads.

- [ ] **Step 5: Create admin user in Supabase**

In Supabase SQL editor:
```sql
-- After the user has signed in at least once via the login page,
-- insert their app_users row with admin role:
INSERT INTO app_users (id, email, full_name, role)
SELECT id, email, raw_user_meta_data->>'full_name', 'admin'
FROM auth.users
WHERE email = 'touchamalendu@gmail.com'
ON CONFLICT (id) DO UPDATE SET role = 'admin';
```

- [ ] **Step 6: Commit final state**

```bash
git add -A
git commit -m "chore: final cleanup post-deployment"
git push origin main
```

---

## Self-Review Notes

**Spec coverage check:**
- ✅ Supabase clients (browser, server, sql wrapper) — Tasks 3, 17
- ✅ Middleware route protection — Task 4
- ✅ Login page matching reference design — Task 5
- ✅ Sign-out in TopNav — Task 6
- ✅ Schema applied to Supabase — Task 7
- ✅ Reference data seeded — Task 8
- ✅ Ingest rewritten for Postgres — Task 9
- ✅ All API routes updated — Tasks 10–16
- ✅ DuckDB removed — Tasks 1, 17
- ✅ Vercel deployment — Task 19
- ✅ Admin user created — Task 19 Step 5

**Key risk:** Tasks 14–16 rewrite API routes from `sdd_awbs` to pre-agg tables. The SQL shape changes significantly. If any pre-agg table has missing data after ingest, those pages will show zeros. Fix by verifying `hub_day_l8d` row counts after Task 18 Step 1.
