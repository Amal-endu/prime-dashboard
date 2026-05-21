# Config Wiring — Design Spec

**Date:** 2026-05-22  
**Status:** Approved — Ready for Implementation

---

## 1. Problem

The Configuration page has 11 parameters. Only 2 (`delPctGreenThreshold`, `delPctAmberThreshold`) actually affect the UI. The remaining 9 are saved to `localStorage` but never read by any API or SQL query. Changing "Regular Rider Min Login %" from 80 to 70 has no effect on Rider Profiling data.

---

## 2. Scope

### Wired (takes effect immediately on Save)

| Parameter | Affects |
|-----------|---------|
| `morningEveningCutoff` | Rider classification SQL |
| `analysisWindowDays` | Rider classification SQL |
| `newRiderWindowDays` | Rider classification SQL |
| `eveningRiderThreshold` | Rider classification SQL |
| `crossUtilEveningThreshold` | Rider classification SQL |
| `regularThreshold` | Rider classification SQL |
| `mr3CutoffHour` | 3MR filter in delivery/details/demand APIs |
| `delPctGreenThreshold` | Already working (frontend colour) |
| `delPctAmberThreshold` | Already working (frontend colour) |

### Not wired (requires re-ingest — noted in UI)

| Parameter | Reason |
|-----------|--------|
| `attemptStatusCodes` | `latest_status` values are stored at ingest time in `sdd_awbs` |
| `breachFlagValues` | `breach` boolean is resolved at ingest time |

---

## 3. Data Flow

```
User saves config
       │
       ▼
ConfigProvider.saveConfig()
  - persists to localStorage
  - increments configVersion counter
       │
       ├──► ToastProvider.startRefresh(totalFetchCount)
       │       tracks in-flight requests
       │
       └──► All pages re-fetch (configVersion in useEffect deps)
              pass config thresholds as query params via toApiParams(config)
                     │
                     ▼
              API routes receive params
              build classification SQL dynamically (inline CTE, parameterized)
              return fresh data
                     │
                     ▼
              ToastProvider.completeOne() per completed fetch
              → progress = completed / total × 100
              → if all complete in < 5s: show "✓ Config applied" (2s)
              → if any fetch takes ≥ 5s: show progress bar until done, then success
              → if any fetch fails: show error toast with Retry button
```

---

## 4. Frontend Changes

### 4.1 `lib/config-params.ts` (new)

Single helper that maps `Config` to API query params. All pages import this — no page builds params manually.

```ts
export function toApiParams(config: Config): Record<string, string> {
  return {
    windowDays:       String(config.analysisWindowDays),
    newRiderDays:     String(config.newRiderWindowDays),
    eveningThreshold: String(config.eveningRiderThreshold),
    crossThreshold:   String(config.crossUtilEveningThreshold),
    regularThreshold: String(config.regularThreshold),
    mr3CutoffHour:    String(config.mr3CutoffHour),
  }
}
```

### 4.2 `components/config-provider.tsx`

- Add `configVersion: number` to context (starts at 0)
- Add `saveConfig(config: Config): void` — persists to localStorage, sets config state, increments version, notifies toast system
- Existing `setConfig` remains for internal use; pages call `saveConfig` on user-initiated saves only

### 4.3 `components/toast-provider.tsx` (new)

Global toast rendered in `app/layout.tsx`. Bottom-right, z-50.

**Context API:**
```ts
startRefresh(total: number): void   // called by saveConfig
completeOne(): void                 // called by each page fetch on success
failAll(): void                     // called on any fetch error
reset(): void                       // internal — clears state
```

**Toast states:**
- **Idle:** nothing rendered
- **In-progress (< 5s elapsed):** no toast yet (avoids flash for fast refreshes)
- **In-progress (≥ 5s elapsed):** `"Refreshing data… X%"` with progress bar
- **Complete:** `"✓ Configuration applied"` green toast, auto-dismisses after 2s
- **Error:** `"Failed to apply config — please retry"` red toast with Retry button (Retry re-increments configVersion)

Progress = `completed / total × 100`, rounded to nearest integer.

### 4.4 `app/configuration/page.tsx`

- Call `saveConfig(draft)` instead of `setConfig(draft)` on Save
- Add note below `attemptStatusCodes` and `breachFlagValues` fields: *"Takes effect on next ingest"* in `text-slate-400 text-xs`

### 4.5 Pages — fetch hook changes

All four data pages (`app/page.tsx`, `app/rider-details/page.tsx`, `app/rider-delivery/page.tsx`, `app/demand/page.tsx`) get the same treatment:

1. Read `config` and `configVersion` from `useConfigState()`
2. Add `configVersion` to `useEffect` dependency array
3. Merge `toApiParams(config)` into the fetch URL params
4. On fetch complete → call `toast.completeOne()`
5. On fetch error → call `toast.failAll()`

Pages that make multiple fetches (e.g. `app/rider-details/page.tsx` fetches details + trend) each count as separate completions toward the total.

**Total fetch count:** Pages only re-fetch if they are currently mounted. `ToastProvider` uses a registration model: each page calls `toast.register()` when it starts a config-triggered fetch and `toast.completeOne()` when it finishes. `saveConfig()` calls `toast.startRefresh()` to reset the counter before pages re-fetch. The toast resolves when all registered fetches complete. This handles the case where the user is only on one page (1 fetch) or has navigated such that multiple pages are mounted.

---

## 5. API Changes

### 5.1 `lib/validators.ts` — new parse helpers

```ts
// Numeric threshold 0–100, falls back to defaultVal if param absent or invalid
export function parseThreshold(raw: string | null, defaultVal: number): number

// Positive integer day count, falls back to defaultVal
export function parseWindowDays(raw: string | null, defaultVal: number): number

// Hour 0–23, falls back to defaultVal
export function parseHour(raw: string | null, defaultVal: number): number
```

All three are safe: if the param is missing, the hardcoded default is used — existing behaviour is fully preserved.

### 5.2 Classification SQL pattern

`v_rider_summary` is **not replaced or dropped**. It stays as a view for queries that don't need custom thresholds (e.g. status checks).

For API routes that serve configurable data, the classification is rebuilt as an inline `cfg` CTE at the top of each query:

```sql
WITH cfg AS (
  SELECT
    ?  AS window_days,          -- analysisWindowDays
    ?  AS new_rider_days,       -- newRiderWindowDays
    ?  AS cutoff_hour,          -- morningEveningCutoff (unused in current SQL but preserved)
    ?  AS evening_threshold,    -- eveningRiderThreshold
    ?  AS cross_threshold,      -- crossUtilEveningThreshold
    ?  AS regular_threshold     -- regularThreshold
),
-- ... rest of v_rider_summary logic referencing cfg.*
```

This is identical to the existing `v_rider_summary` SQL — just with literals replaced by `cfg` column references.

### 5.3 Routes updated

| Route | New params | SQL change |
|-------|-----------|-----------|
| `GET /api/profiling` | `windowDays`, `newRiderDays`, `eveningThreshold`, `crossThreshold`, `regularThreshold` | Inline cfg CTE for all three queries (city, hub, rider) |
| `GET /api/profiling/matrix` | Same | Inline cfg CTE |
| `GET /api/profiling/volume-matrix` | Same | Inline cfg CTE |
| `GET /api/details` | `mr3CutoffHour` | `HOUR(received_at_hub_time) >= ?` instead of `>= 15` in overall_src CTE |
| `GET /api/details/trend` | `mr3CutoffHour` | Same |
| `GET /api/delivery` | `mr3CutoffHour` | Same in v_3mr_delivery equivalent filter |
| `GET /api/demand` | `mr3CutoffHour` | Same |

`v_3mr_delivery` view is also **not replaced** — routes that use the `mr3CutoffHour` param switch from using the view to an equivalent inline CTE (same pattern as the existing `overall_src` CTE in `api/details/route.ts`).

---

## 6. What Does Not Change

- `v_rider_summary` and `v_3mr_delivery` views remain in DuckDB unchanged
- `delPctGreenThreshold` / `delPctAmberThreshold` wiring is unchanged
- `backend/ingest.js` is unchanged
- `localStorage` schema is unchanged
- All existing query params on each route continue to work

---

## 7. Out of Scope

- `attemptStatusCodes` and `breachFlagValues` — requires re-ingest, not wired
- Persisting config server-side (stays in localStorage only)
- Multi-tab sync (if user has two browser tabs, config change in one won't update the other)
