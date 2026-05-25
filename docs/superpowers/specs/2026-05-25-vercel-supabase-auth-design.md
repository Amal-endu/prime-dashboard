# Prime Dashboard — Vercel + Supabase + Auth Design

**Date:** 2026-05-25  
**Status:** Approved  
**Goal:** Host Prime Dashboard on Vercel, move data layer from DuckDB to Supabase Postgres, add email/password login with role-based access.

---

## 1. Architecture Overview

```
Browser
  │
  ▼
Vercel (Next.js App Router)
  │  middleware.ts — checks Supabase session cookie on every request
  │  Unauthenticated → redirect to /login
  │  Authenticated → proceed to page/API route
  │
  ├── app/login/page.tsx          — public, no auth required
  ├── app/* (all other pages)     — protected
  └── app/api/* (all API routes)  — protected, use service-role Supabase client
          │
          ▼
      Supabase (hosted Postgres)
        ├── auth schema   — Supabase-managed (email/password sessions)
        └── public schema — app tables (rider_daily, hub_day_l8d, etc.)
```

**Data flow for API routes:**
- Requests arrive at Next.js API routes on Vercel
- Routes use a server-side Supabase client initialised with the **service role key** (bypasses RLS — safe because this is server-side only, never exposed to the browser)
- The browser Supabase client uses the **anon key** — used only for auth (sign in / sign out / session refresh)

---

## 2. Supabase Client Architecture

Three clients, each for a different context:

| File | Client type | Key used | Purpose |
|------|-------------|----------|---------|
| `lib/supabase/server.ts` | Server (SSR) | Service role | API routes — full DB access |
| `lib/supabase/browser.ts` | Browser | Anon | Login page — sign in/out only |
| `lib/supabase/middleware.ts` | Middleware | Anon | Session validation + cookie refresh |

The server client replaces `backend/db.ts`. All existing `query<T>()` call sites in API routes are replaced with `supabase.from(...).select(...)` or raw SQL via `supabase.rpc(...)`.

---

## 3. Authentication

**Method:** Supabase Auth — email + password  
**Session storage:** HTTP-only cookies (set by `@supabase/ssr`)  
**User management:** Admin creates users via Supabase dashboard (no self-serve signup on login page)

**Flow:**
1. Unauthenticated user hits any route → middleware redirects to `/login`
2. User enters email + password → server action calls `supabase.auth.signInWithPassword()`
3. Supabase sets session cookies → middleware allows through
4. Sign out → `supabase.auth.signOut()` → cookies cleared → redirect to `/login`

**Roles:**
- `admin` — can read all data + write `app_config`
- `viewer` — read-only dashboard
- Role stored in `public.app_users.role` (already in schema)
- After sign-in, API checks `app_users` row to enforce config-write permission

---

## 4. Login Page

Matches [rider-dash-fixed.html] reference design:
- Centered white card on light background (`#FAFBFD`)
- Shadowfax logo (`/public/shadowfax-logo.svg`) above the form
- Title: "Prime Dashboard" subtitle: "Sign in to continue"
- Fields: Email address, Password
- Button: orange gradient "Sign In" (`.btn-primary`)
- Error state: red alert box above form fields
- No signup link (users are created by admin)
- No "forgot password" for now (can add later)

---

## 5. Middleware

`middleware.ts` at project root. Runs on all routes except:
- `/login`
- `/api/auth/*` (Supabase auth callbacks)
- `/_next/*`, `/favicon.ico` (static assets)

Checks session cookie. If missing or expired → redirect to `/login?next=<original-path>`. After login, redirect back to `next`.

---

## 6. Database Migration

**Schema:** Already written at `sql/schema.sql`. Apply once to Supabase via SQL editor or `psql`.

**API route changes:**
- Replace `import { query } from '@/backend/db'` with `import { createServerClient } from '@/lib/supabase/server'`
- Replace DuckDB parameterised queries with Supabase `.rpc()` calls for complex queries, or raw SQL via `supabase.rpc('sql', { query: ... })` — actual approach: use `postgres` connection string directly for complex multi-join queries via a thin `lib/supabase/sql.ts` wrapper using the `DATABASE_URL` env var (Supabase exposes a direct Postgres connection string)
- All existing SQL queries are compatible with Postgres — no logic changes needed, only the connection layer changes

**Ingest (`backend/ingest.js`):**
- Replace DuckDB write calls with Supabase Postgres inserts via `DATABASE_URL` (direct connection, not REST API — faster for bulk ingest)
- Use `pg` npm package for the ingest script (server-side Node.js, not browser)

---

## 7. Environment Variables

```
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
DATABASE_URL=postgresql://postgres:<password>@db.<project>.supabase.co:5432/postgres

# Optional: direct connection for ingest
DATABASE_URL_INGEST=<same or pooled connection>
```

Set in:
- Local: `.env.local` (gitignored)
- Vercel: Project Settings → Environment Variables

---

## 8. Vercel Deployment

- `vercel.json` — not required for standard Next.js; Vercel auto-detects
- Build command: `npm run build` (already correct)
- Output: Next.js (auto-detected)
- Node version: 20.x (set in Vercel project settings)
- The `duckdb` npm package will be removed from dependencies (native binary, incompatible with Vercel serverless)
- The `backend/watcher.js` file-watcher is local-only — not deployed

**DuckDB removal:** `duckdb` is a native module that doesn't run on Vercel's serverless environment. Once the Supabase migration is complete, `duckdb` is removed from `package.json`.

---

## 9. Implementation Checklist

1. Install `@supabase/supabase-js`, `@supabase/ssr`, `pg` packages; remove `duckdb`
2. Create `.env.local` with all 4 env vars
3. Create `lib/supabase/server.ts` — service-role server client
4. Create `lib/supabase/browser.ts` — anon browser client
5. Create `lib/supabase/middleware-client.ts` — session-aware middleware client
6. Create `lib/supabase/sql.ts` — thin Postgres query wrapper using `DATABASE_URL` (replaces `backend/db.ts` interface)
7. Create `middleware.ts` at project root — session guard + redirect logic
8. Create `app/login/page.tsx` — login UI matching reference design
9. Create `app/login/actions.ts` — `signIn()` and `signOut()` server actions
10. Add sign-out button to `TopNav`
11. Update all API routes to use `lib/supabase/sql.ts` instead of `backend/db.ts`
12. Update `backend/ingest.js` to use `pg` + `DATABASE_URL` instead of DuckDB
13. Apply `sql/schema.sql` to Supabase project
14. Seed `hub_mapping`, `cpo`, `prime_clients` from existing CSVs
15. Test locally with Supabase credentials
16. Deploy to Vercel — set env vars in dashboard
17. Create first admin user via Supabase Auth dashboard + insert `app_users` row
