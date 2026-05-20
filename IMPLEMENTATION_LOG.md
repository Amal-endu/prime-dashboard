# Prime Dashboard — Implementation Log

A running record of bugs caught, design gaps found, and learnings applied.
Reference for future feature work — read this before touching any page.

---

## 2026-05-20 · Session 1 — Initial Build + Backend Connection

### What was built
- Full Next.js 16 app with DuckDB backend
- 5 views: Rider Profiling, Rider Details, Rider Delivery, Demand Data, Configuration
- Global KPI strip, top nav, expandable City→Hub→Rider tree tables

### Bugs caught during build
| # | File | Bug | Fix |
|---|------|-----|-----|
| 1 | `backend/ingest.js` | CTE named `window` — reserved keyword in DuckDB | Renamed to `date_range` |
| 2 | `backend/ingest.js` | `DEFAULT current_timestamp` syntax invalid in DuckDB | Changed to `DEFAULT now()` |
| 3 | `next.config.ts` | Turbopack (Next 16 default) cannot bundle DuckDB native addon | Added `--webpack` flag to dev script |
| 4 | `backend/db.js` | `__dirname` resolves to `.next/server/` after webpack bundling | Switched to `process.cwd()` |
| 5 | `app/demand/page.tsx` | Recharts `formatter` TypeScript type mismatch | Fixed: `formatter={(v) => [formatNumber(Number(v)), '3MR']}` |

---

## 2026-05-20 · Session 2 — Rider Count Mismatch Fix + Profiling Redesign

### Bug: Rider count mismatch in Rider Profiling
**Symptom:** KPI cards showed ~18,998 riders but the full dataset has 28,148 riders.

**Root cause:**
- 9,150 riders belong to 361 hubs NOT present in `hub_mapping.csv`
- These riders get `NULL` city in `v_rider_summary` (LEFT JOIN on hub_mapping)
- All API queries used `WHERE city IS NOT NULL`, silently dropping 32% of riders
- The 5,000-row rider limit in the GET query further truncated results (18,998 actual mapped riders)

**Fix applied:**
- `app/api/profiling/route.ts`: Removed all `WHERE city IS NOT NULL` filters
- Used `COALESCE(city, 'Unmapped')` and `COALESCE(zone, '—')` throughout
- Added raw counts (evening_count, morning_count, etc.) alongside percentages to API response
- Removed the LIMIT 5000 on rider rows — full dataset returned

**Lesson:** Always verify total counts by comparing API KPI query with raw `SELECT COUNT(*)` on the base view. Null-exclusion filters silently drop data.

### Design: Count vs % toggle for Profiling table
**Change:** Columns now show **raw counts by default**, with a `Count / %` pill toggle to switch to percentages.
**Why:** For ops users, "15 Evening Riders" is more actionable than "34.1%" at city and hub level.
**Toggle location:** Right side of filter bar, styled as a segmented pill (matching top-nav tab style).

### Design: Unmapped riders now visible
- "Unmapped" city row appears at the top of the tree (largest group: 9,150 riders)
- Hubs within Unmapped are expandable and show individual rider tags
- Helps identify hubs missing from hub_mapping.csv — a data quality signal

---

## 2026-05-20 · Session 3 — Reference HTML Audit + Detailed Expand Redesign

### Gaps identified vs reference (rider-dash-fixed.html)

| Gap | Severity | Description |
|-----|----------|-------------|
| No detailed row on expand | HIGH | When a rider row is expanded, it only shows the same columns. Reference shows a rich detail card with all available fields |
| Alignment inconsistency | MED | Right-aligned numbers not consistently `tabular-nums`. City/hub label columns vary in indentation |
| StatCard has no top accent bar | MED | Reference uses a 3px colour accent bar at the top of KPI cards. Our StatCards use background tint only |
| Table font size | LOW | Reference uses 12px table body with 11px headers. Current uses 14px (sm default), making tables dense |
| No result count | LOW | Reference shows "Showing X of Y riders" meta line above tables |
| Missing `pod_name` in rider detail | MED | `v_rider_summary` has `pod_name` and `total_days`, `login_days` columns not surfaced in UI |
| Data fields unused | MED | `morning_login_days`, `evening_login_days`, `first_ever_login`, `active_since_days` all available but shown as small secondary text only — should be in detail expand |

### Fields available in v_rider_summary (full list)
```
rider_id, rider_name, hub, pod_name, city, zone,
total_days,           -- window length in days (30)
login_days,           -- days actually logged in
morning_login_days,   -- days with morning runsheet
evening_login_days,   -- days with evening runsheet
login_rate_pct,       -- login_days / total_days * 100
evening_login_rate_pct,
first_login_in_window, first_ever_login, max_date,
active_since_days,    -- days since first_ever_login
is_new_rider,         -- boolean
login_behaviour_tag,  -- Evening Rider / Cross Utilised / Morning Rider
regularity_tag        -- Regular / Irregular / New Rider
```

### Pattern from reference to adopt
- Rider row expand → full-width detail card below the row (not a new modal)
- Detail card grid: identity info left, stats centre, tags right
- Monospace font for numeric data
- Section headers with `::after` divider line inside detail card

### TypeScript `unknown` type errors in API routes
**Symptom:** Multiple build failures across `demand/route.ts`, `delivery/route.ts`, `details/route.ts`, `status/route.ts`, `profiling/route.ts`.

**Root cause:** DuckDB's `query()` wrapper returns `any[]` but TypeScript infers destructured row fields as `unknown`. Passing `unknown` to `new Date()`, using it as a Record index `map[r.city]`, or calling `.slice()` on it all fail strict type checking.

**Pattern to follow for all API routes:**
```ts
// Casting pattern when using row fields as types:
new Date(max_date as string)
Object.fromEntries(rows.map(r => [r.city as string, Number(r.val)]))
const key = r.city as string; if (!map[key]) map[key] = []
(r.first_login_date as string | null)?.slice(0, 10) ?? ''
```

**Rule:** Always cast DuckDB row fields to concrete types (`as string`, `as string | null`) before passing to type-sensitive APIs.

---

## 2026-05-20 · Session 4 — raw_data.csv Correctness Audit (May 19)

### Q: Was raw_data.csv used anywhere?
**Yes — it is the sole source for the entire Rider Profiling view.**

Data flow:
```
raw_data.csv  →  rider_daily table  →  v_rider_summary view  →  /api/profiling  →  Rider Profiling page
SDD_Data_*.csv → sdd_awbs table    →  v_3mr_delivery view   →  /api/delivery + /api/demand
```
The two pipelines are **completely independent**. They never join to each other.

### Finding 1: rider_id format mismatch breaks all cross-table joins
| Source | rider_id format | Example |
|--------|----------------|---------|
| `rider_daily` (raw_data.csv) | Integer string | `10082916` |
| `sdd_awbs` (SDD_Data files) | Float string | `10082916.0` |

**Impact:** Any query that tries to join `rider_daily` to `sdd_awbs` via `rider_id` returns 0 results. The dashboards avoid this today because Rider Profiling and Rider Delivery use separate views — but any future feature that tries to cross-reference (e.g., "show delivery performance for each profiled rider") will silently produce empty results.

**Workaround for joins:** `SPLIT_PART(sdd_awbs.rider_id, '.', 1) = rider_daily.rider_id`

**Fix applied in ingest.js** (`npm run reingest` to reprocess existing files):
```js
REGEXP_REPLACE(TRIM(CAST(rider_id AS VARCHAR)), '\\.0$', '') AS rider_id
```
✅ Verified: 0 rows with `.` suffix. Cross-join now returns 11,659 matched riders on May 19.
Added `npm run reingest` (`--force`) script to package.json for future full re-ingests.

### Finding 1b: CPO city name mismatch broke Bangalore and Bhubaneswar earnings
- `hub_mapping` uses `Bangalore` and `Bhubaneswar`
- Old `CPO.csv` had `Bengaluru` and `Bhubneshwar` → CPO JOIN returned NULL → earnings showed ₹0 for both cities
- Fixed: CPO.csv updated to match hub_mapping spelling. Re-ingested with `--force`.
- **Rule:** city names in `CPO.csv` must exactly match city names in `hub_mapping.csv` — case and spelling sensitive.

### Finding 2: Two completely different classification systems coexist
| System | Source | Tags | Who computes it |
|--------|--------|------|-----------------|
| `login_behaviour_tag` | raw_data.csv | Evening Rider / Cross Utilised / Morning Rider | Our `v_rider_summary` SQL logic |
| `rider_tag` | SDD_Data_*.csv | Dedicated / Cross utilised / Unidentified | Shadowfax upstream system |

These are **not the same thing** and are derived independently. Our classification uses 30-day login history from raw_data; the SDD tag appears to be set at the AWB/dispatch level by a different system.

**May 19 example — rider 10082916 (Aneesh B, AAL_Attingal1_SCC):**
- raw_data: 24 morning days, 1 evening day → our system → `Morning Rider`
- sdd_awbs: `rider_tag = Cross utilised` on some AWBs, `Unidentified` on others

This is not necessarily a data error — they measure different things. Our classification is 30-day behaviour-based; the SDD tag is AWB-dispatch-level.

### Finding 3: 4,480 riders in raw_data have zero 3MR AWBs on May 19
- Total riders in raw_data on May 19: **16,139**
- Riders who also appear in sdd_awbs on May 19: **11,659** (72%)
- Riders in raw_data ONLY: **4,480** (28%)

Of those 4,480 raw_data-only riders:
- 4,334 are morning-run riders (logged in, but no 3MR shipments assigned)
- 146 have no runsheet hour at all (logged in but no attempts)

**This is expected and correct.** 3MR (evening run) AWBs only exist for riders with `received_at_hub_time >= 15:00`. Morning riders who don't have evening assignments simply won't appear in `sdd_awbs` for a given day.

### Finding 4: All 11,659 riders in sdd_awbs(May 19) have a matching raw_data entry
Zero riders in sdd_awbs without a raw_data row — the reverse coverage is 100%. This confirms raw_data.csv is a superset of the riders who do SDD.

### Summary: raw_data.csv data quality verdict
| Check | Result |
|-------|--------|
| Date range coverage | Apr 20 – May 19 (30 days) ✓ |
| Rider coverage vs SDD | Superset — includes all SDD riders + morning-only riders ✓ |
| Morning login hours match SDD first_runsheet_time | ✓ (where matched manually) |
| Classification logic correctness | Working as designed — separate from SDD rider_tag |
| rider_id format | Mismatch with sdd_awbs (`.0` suffix) — needs fix |

---

## 2026-05-20 · Session 5 — Regularity Bug + Filter Fix + 3×3 Matrix

### Bug: Irregular count was always 0 (critical data bug)
**Symptom:** All 28,148 riders showed as Regular or New Rider. Irregular count = 0.

**Root cause:**
- `raw_data.csv` only contains rows for days when a rider actually logged in — there are no "absent" rows
- `total_days = COUNT(*)` in the `agg` CTE therefore equals `login_days` for every rider
- `login_rate_pct = login_days / total_days = 100%` always
- The 80% threshold for Regularity was never triggered

**Fix applied in `backend/ingest.js` (v_rider_summary view):**
- Changed `total_days` to the fixed 30-day window constant instead of `COUNT(*)`
- Changed `login_rate_pct` to `login_days / 30` (calendar days), not `login_days / total_days`
- `evening_login_rate_pct` kept as `evening_days / login_days` (behaviour-relative, not calendar-relative — intentional)
- Re-run `node backend/ingest.js` (views only, no CSV reingest needed)

**Result after fix:** Regular=10,220 · Irregular=15,627 · New Rider=2,301

**Rule added:** When a source table only has "event" rows (no absence rows), never use COUNT(*) from that table as the denominator for rate calculations. Use the fixed calendar window instead.

### Bug: Profiling filters (Behaviour/Regularity) didn't refresh city/hub tables
**Symptom:** Dropdowns changed but city/hub aggregates stayed the same.
**Root cause:** API route `GET()` accepted no parameters — filters were only applied client-side on rider rows, not passed to the SQL aggregation queries.
**Fix:** Added `behaviour` and `regularity` query params to the API; all three queries (city, hub, rider) now include WHERE clauses from these params. `useEffect` dependency array updated to `[behaviourFilter, regularityFilter]`.

### Feature: 3×3 Regularity × Behaviour matrix
Added `MatrixTable` component showing Regular/Irregular/New Rider × Evening/Cross Utilised/Morning Rider.
- Each cell shows count + % of total riders
- Column totals and row totals included
- Matrix always shows global (unfiltered) numbers — filters only affect the tree table below it
- Data fetched from new `matrix` field in `/api/profiling` response

---

---

## 2026-05-20 · Session 7 — Rider Details: City Summary Table + Simplified Presets + Productivity Trend

### Changes

**1. Date presets simplified**
Removed D-1 through D-7. Presets are now: **Today · L7D · L30D** only.

**2. City Summary Table (new section)**
New table above the tree, always visible. Sourced from `rider_daily` (all logged-in riders) + `sdd_awbs` (earnings):

| Column | Formula |
|---|---|
| Riders Logged In | `COUNT(DISTINCT rider_id)` from `rider_daily` for selected window, per city |
| Avg Attempt Prod / Rider | `SUM(attempted_total) ÷ COUNT(DISTINCT rider_id)` — raw daily shipment attempts per logged-in rider. Covers all riders including morning-only |
| Avg Earnings / Rider | `SUM(delivered_3mr × CPO) ÷ riders_logged_in` — total 3MR earnings for city ÷ all logged-in riders (not just those with 3MR AWBs) |

Grand total row uses weighted average for attempt productivity (city rider-count weighted), total earnings / total riders for avg earnings.

**3. Trend chart: Attempt % → Avg Attempt Productivity / Rider**
`attempt_pct` (attempted/assigned × 100) replaced with `avg_attempt_productivity` = `SUM(attempted_total) / COUNT(DISTINCT rider_id)` from `rider_daily`. Shows raw attempts per rider per period, not a ratio.

Source change: productivity now comes from `rider_daily` via a JOIN sub-query in both the L7D daily and L30D weekly trend queries. Earnings denominator also updated to use `riders_logged_in` from `rider_daily` (not `COUNT(DISTINCT rider_id)` from sdd_awbs) so morning-only riders are included.

**4. L30D flat city summary under Trends**
When the L30D toggle is active in the Trends section, a flat city-level table appears below the charts showing the same three columns (Riders Logged In, Avg Attempt Prod / Rider, Avg Earnings / Rider) computed over the full 30-day window. This is the "average daily numbers" view — all figures are already per-rider averages across the period.

**Files changed:**
- `app/api/details/route.ts` — city query extended with `rd_city` CTE from `rider_daily`; new fields `riders_logged_in`, `avg_attempt_productivity`, `avg_earnings_per_rider` in response
- `app/api/details/trend/route.ts` — `buildTrendQuery` updated; `attempt_pct` replaced with `avg_attempt_productivity`; `TrendRow` type updated
- `app/rider-details/page.tsx` — `DATE_PRESETS` simplified; `TrendCharts` props updated; city summary table added; L30D city table added inside `TrendCharts`

---

## 2026-05-20 · Session 6 — Rider Details: Rider-Level Columns from raw_data

### Feature: Raw_data fields surfaced at rider row level

**Request:** Rider rows in the Rider Details tab (when expanded at hub level) should show:
Rider ID, Name, Login Shift (Behaviour badge), Regularity badge, Morning Avg Productivity, Evening Avg Productivity, Morning Runsheet Hr, Evening Runsheet Hr — all from `raw_data.csv`.

**Changes made:**

| File | Change |
|------|--------|
| `app/api/details/route.ts` | Added `raw_agg` CTE to rider query — computes `AVG(attempt_morning)`, `AVG(attempt_evening)`, `AVG(morning_runsheet_hour)`, `AVG(evening_runsheet_hour)` from `rider_daily` filtered to the selected date window. NULLs excluded from AVG (only active-run days count). Added 4 new fields to API response per rider. |
| `app/rider-details/page.tsx` | Added 4 new header columns (Morn Avg Prod, Eve Avg Prod, Morn RS Hr, Eve RS Hr). City and hub rows span these columns with `—`. Grand total row spans them too. Rider rows render the new fields with colour coding (orange=morning, indigo=evening). `RiderDrilldown` colSpan updated from 10→14. |

**Design decisions:**
- AVG excludes null runs: `AVG(CASE WHEN attempt_morning > 0 THEN attempt_morning END)` — a day with no morning run doesn't drag down the morning productivity average.
- Runsheet hour displayed as `HH:00` (floored to integer hour) — matches how the daily drilldown shows it.
- Column header: "Shift" instead of "Behaviour" — shorter, ops-friendly label at rider level.
- Orange = morning, Indigo = evening — consistent with the daily drilldown colour coding already in place.

**Column count:** 10 → 14 total columns. Table is wider; horizontal scroll is already enabled via `overflow-x-auto`.

---

## Rules / Invariants for Future Work

1. **Always verify totals**: after any API change, cross-check KPI count vs `SELECT COUNT(*)` on source view
2. **No silent NULL exclusions**: use `COALESCE` or explicitly show "Unmapped" groups
3. **No LIMIT on rider queries**: with 28K riders this is fast enough; limits cause user confusion
4. **Counts before percentages**: default display should be raw numbers; % is secondary (via toggle)
5. **All expand rows must be richer than parent**: clicking a row should reveal data not visible at city/hub level
6. **tabular-nums on all numeric cells**: prevents column width jitter on scroll
7. **Alignment**: city rows left-pad with chevron+name; hub rows indent `pl-10`; rider rows indent `pl-16` — never deviate
8. **Data date always visible**: the KPI strip and page subtitles must show the data date so users know if data is stale
