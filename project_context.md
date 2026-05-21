# Prime Dashboard — Project Context

> **Purpose of this document:** Complete reference for anyone (human or AI) making improvements to this codebase.
> Covers what is built, why it exists, how data flows, every formula, every classification rule, and known quirks to avoid.

---

## 1. What This Is

A **local-first, fullstack operations dashboard** for Shadowfax's Prime SDD (Same Day Delivery) business.
It answers two questions that ops teams need continuously:

1. **How are riders behaving?** — Login patterns, regularity, shift distribution (Rider Profiling)
2. **How are deliveries performing?** — Productivity, DEL%, earnings, breach counts (Rider Details, Rider Delivery, Demand Data)

Built for macOS, runs entirely locally. Data lives in a DuckDB file (`prime.duckdb`). No backend server — Next.js API routes query DuckDB directly.

---

## 2. Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js (App Router) + TypeScript |
| Styling | Tailwind CSS + custom Shadowfax orange palette |
| Charts | Recharts |
| Database | DuckDB (`prime.duckdb` — local file) |
| Data ingest | Node.js script (`backend/ingest.js`) |
| Auto-ingest watcher | `backend/watcher.js` (chokidar) |
| DB access layer | `backend/db.ts` (singleton, parameterized queries only) |

**Important:** Next.js is running with `--webpack` (not Turbopack). Turbopack cannot bundle DuckDB's native addon. Never switch to the default dev command.

---

## 3. Data Sources

### 3.1 Input Files

| File | Location | Purpose |
|------|----------|---------|
| `SDD_Data_<N>May.csv` | `SDD_Data/May/` | AWB-level SDD operational data. ~180K rows/day. Primary data source. |
| `raw_data.csv` | repo root | Pre-aggregated rider-per-day login and attempt data. Sole source for Rider Profiling. |
| `hub_mapping.csv` | repo root | Hub → pod_name → zone → city hierarchy |
| `CPO.csv` | repo root | City → base_pay, sdd_pay, total_pay (cost per order). Used for earnings calculation. |
| `prime_clients.csv` | repo root | List of Prime (C2) client names. Used for C2 filter across all views. |

### 3.2 SDD CSV Key Fields

| Field | Usage |
|-------|-------|
| `awb_number` | Primary key (one row per AWB) |
| `rider_id` | Rider identifier — arrives as float string (e.g. `10082916.0`), stripped to integer at ingest |
| `rider_name` | Display name |
| `rider_tag` | **Source tag** from Shadowfax upstream: `Dedicated` / `Cross utilised` / `Unidentified`. Different from our derived `login_behaviour_tag`. |
| `hub` | Hub code |
| `client_name` | Client name — matched against `prime_clients.csv` to flag C2 shipments |
| `latest_status` | `DELIVERED` / `CID` / `NOT_CONTACTABLE` / other |
| `received_at_hub_time` | Timestamp when AWB arrived at hub. Used for 3MR classification. |
| `ofd_time` | Out-for-delivery timestamp. Used as the date of an AWB. |
| `first_runsheet_time` | First runsheet scan time. Used to detect morning/evening login in original design (NOT used in current implementation — see §3.3). |
| `breach` | Boolean SLA breach flag (stored as string `true`/`1`/`yes`) |
| `pod_mapping` | Pod/area name |
| `pod_zone` | Zone within pod |
| `city_id` | Integer city identifier |

### 3.3 raw_data.csv Key Fields

| Field | Maps to DB column | Notes |
|-------|------------------|-------|
| `dates` | `date` (DATE) | Format: `DD-MM-YYYY` |
| `hub` | `hub` | |
| `rider_id` | `rider_id` | Stored as integer string, no `.0` suffix |
| `rider_name` | `rider_name` | |
| `first_runsheet_hour_in_morning_run` | `morning_runsheet_hour` | Hour of first morning runsheet (NULL = no morning run) |
| `first_runsheet_hour_in_evening_run` | `evening_runsheet_hour` | Hour of first evening runsheet (NULL = no evening run) |
| `attempt_in_morning_run` | `attempt_morning` | Number of attempts in morning run |
| `attempt_in_evening_run` | `attempt_evening` | Number of attempts in evening run |
| `attempted_shipment` | `attempted_total` | Total attempts (morning + evening) |

**Critical note:** `raw_data.csv` only contains rows for days when a rider actually logged in — there are no "absent" rows. This means `COUNT(*)` over this table for a rider equals login days, not calendar days.

---

## 4. Database Schema

### Tables

#### `hub_mapping`
```sql
hub        VARCHAR  PRIMARY KEY
pod_name   VARCHAR
zone       VARCHAR
city       VARCHAR
```
City names here must match CPO.csv exactly (case + spelling). Known issue: `Bangalore` not `Bengaluru`, `Bhubaneswar` not `Bhubneshwar`.

#### `cpo`
```sql
city       VARCHAR  PRIMARY KEY
base_pay   DOUBLE
sdd_pay    DOUBLE
total_pay  DOUBLE    -- used for earnings: delivered_3mr × total_pay
```

#### `prime_clients`
```sql
client_name  VARCHAR  PRIMARY KEY
```
Matching against `sdd_awbs.client_name` is case-insensitive (`LOWER(TRIM(...))`).

#### `rider_daily`
```sql
date                       DATE
hub                        VARCHAR
rider_id                   VARCHAR
rider_name                 VARCHAR
morning_runsheet_hour      INTEGER   -- NULL = no morning run
evening_runsheet_hour      INTEGER   -- NULL = no evening run
attempt_morning            INTEGER
attempt_evening            INTEGER
attempted_total            INTEGER
PRIMARY KEY (date, rider_id)
```

#### `sdd_awbs`
```sql
awb_number            VARCHAR  PRIMARY KEY
date                  DATE     -- derived: ofd_time::DATE
hub                   VARCHAR
rider_id              VARCHAR  -- float suffix stripped: '10082916.0' → '10082916'
rider_name            VARCHAR
rider_tag             VARCHAR  -- source tag (Dedicated / Cross utilised / Unidentified)
client_name           VARCHAR
latest_status         VARCHAR
received_at_hub_time  TIMESTAMP
ofd_time              TIMESTAMP
first_runsheet_time   TIMESTAMP
breach                BOOLEAN
pod_mapping           VARCHAR
pod_zone              VARCHAR
city_id               INTEGER
```

#### `ingest_log`
```sql
filename    VARCHAR  PRIMARY KEY
ingested_at TIMESTAMP
row_count   INTEGER
```
Tracks which SDD CSV files have been processed. Re-running `ingest.js` skips already-ingested files. Use `--force` to re-ingest everything.

### Views

#### `v_max_date`
```sql
SELECT GREATEST(
  (SELECT MAX(date) FROM rider_daily),
  (SELECT MAX(ofd_time::DATE) FROM sdd_awbs)
) AS max_date
```
Single source of truth for "today" across all queries. All date arithmetic is relative to `max_date`, not `CURRENT_DATE`.

#### `v_rider_summary`
Core view powering Rider Profiling. Classification window = last 30 days from `v_max_date`.

**Key computed columns:**

| Column | Formula | Notes |
|--------|---------|-------|
| `login_days` | `SUM(had_any_login)` | Days with any login (morning OR evening) in window |
| `morning_login_days` | `SUM(had_morning_login)` | Days with a morning runsheet hour |
| `evening_login_days` | `SUM(had_evening_login)` | Days with an evening runsheet hour |
| `login_rate_pct` | `login_days × 100.0 / 30` | **Denominator is always 30** (fixed calendar window, NOT login days) |
| `evening_login_rate_pct` | `evening_login_days × 100.0 / login_days` | Relative to active days, not calendar (intentional — measures behaviour) |
| `first_ever_login` | `MIN(date)` across all `rider_daily` rows | Global, not windowed |
| `active_since_days` | `DATEDIFF('day', first_ever_login, max_date)` | |
| `is_new_rider` | `active_since_days <= 7` | |
| `login_behaviour_tag` | See §5.1 | |
| `regularity_tag` | See §5.2 | |

#### `v_3mr_delivery`
Core view powering Rider Delivery and Demand Data. Filters to 3MR AWBs only.

**3MR filter:** `HOUR(received_at_hub_time) >= 15`

**Key computed columns per rider per date:**

| Column | Formula |
|--------|---------|
| `assigned_3mr` | `COUNT(*)` — all AWBs where received ≥ 15:00 AND ofd_time NOT NULL AND rider_id NOT NULL |
| `attempted_3mr` | `SUM(CASE WHEN latest_status IN ('DELIVERED','CID','NOT_CONTACTABLE') THEN 1 ELSE 0 END)` |
| `delivered_3mr` | `SUM(CASE WHEN latest_status = 'DELIVERED' THEN 1 ELSE 0 END)` |
| `breach_count` | `SUM(CASE WHEN breach THEN 1 ELSE 0 END)` |
| `is_prime` | `TRUE` if `client_name` matches any row in `prime_clients` |

---

## 5. Classification Rules

### 5.1 Login Behaviour Tag

Evaluated in priority order. First match wins.

| Tag | Rule |
|-----|------|
| **Evening Rider** | `morning_login_days = 0` AND `evening_login_rate_pct >= 80` |
| **Cross Utilised** | `morning_login_days >= 1` AND `evening_login_rate_pct >= 70` |
| **Morning Rider** | Everything else (default) |

Threshold defaults: Evening Rider = 80%, Cross Utilised = 70%. Both configurable from the Configuration page.

### 5.2 Regularity Tag

Evaluated in priority order. First match wins.

| Tag | Rule |
|-----|------|
| **New Rider** | `active_since_days <= 7` (first ever login within last 7 days of max_date) |
| **Regular** | Not New AND `login_rate_pct >= 80` |
| **Irregular** | Not New AND `login_rate_pct < 80` |

`login_rate_pct = login_days / 30 × 100`. The denominator is always 30 — not the number of days the rider appeared in the data.

**Invariant:** This was a bug early on. `raw_data.csv` only has rows for days with logins, so `COUNT(*) / COUNT(*)` was always 100%. Fixed by hardcoding the 30-day window as denominator.

### 5.3 3MR Classification

An AWB is "3MR" (Third Milk Run / evening run) if:
- `HOUR(received_at_hub_time) >= 15` (configurable from Configuration page, default = 15)
- `ofd_time IS NOT NULL`
- `rider_id IS NOT NULL`

All non-3MR AWBs are ignored in `v_3mr_delivery`. They do not contribute to any delivery metrics.

---

## 6. Core Metric Formulas

### 6.1 DEL% (Delivery Percentage)
```
DEL% = delivered_3mr / assigned_3mr × 100
```
- Green: ≥ 80% | Amber: 60–79% | Red: < 60%
- Thresholds configurable in Configuration page

### 6.2 Attempt % (ATP%)
```
ATP% = attempted_3mr / assigned_3mr × 100
```
Attempted = DELIVERED + CID + NOT_CONTACTABLE

### 6.3 Breach %
```
Breach% = breach_count / assigned_3mr × 100
```

### 6.4 3MR Earnings
```
Earnings = delivered_3mr × CPO (total_pay for rider's city)
```
CPO comes from `cpo.city = hub_mapping.city` (joined via hub). If CPO is NULL, earnings = 0.

### 6.5 Avg Attempt Productivity (Rider Details trend)
```
Avg Attempt Productivity = SUM(attempted_3mr) / (COUNT(DISTINCT rider_id) × COUNT(DISTINCT date))
```
Raw shipment attempts per rider per day. Not a percentage — an absolute count.

### 6.6 Avg Earnings per Rider
```
Avg Earnings per Rider = SUM(delivered_3mr × CPO) / COUNT(DISTINCT rider_id logged in)
```
Denominator includes all logged-in riders from `rider_daily`, not just those with 3MR AWBs. Morning-only riders are included (with ₹0 contribution), which pulls the average down — intentional.

### 6.7 Demand Trend (vs D-1)
```
Trend % = (today_demand - d1_demand) / d1_demand × 100
Direction: up if > 1%, down if < -1%, flat otherwise
```

### 6.8 L7D / L30D DEL% Trend (Rider Delivery)
```
L7D DEL% = SUM(delivered_3mr over last 7 days) / SUM(assigned_3mr over last 7 days) × 100
Prev 7D DEL% = same formula for days [14..8] back
Delta = L7D DEL% - Prev 7D DEL%
```

---

## 7. Pages and Views

### 7.1 Rider Profiling (`/` — root)
**Data source:** `v_rider_summary` (from `rider_daily` + `hub_mapping`)
**API:** `GET /api/profiling`
**API (filtered matrix):** `GET /api/profiling/matrix?city=X&hub=Y`
**API (volume matrix):** `GET /api/profiling/volume-matrix?city=X&hub=Y`

**What it shows:**
- KPI strip: total riders + breakdown by behaviour tag + regularity tag
- 3×3 matrix (Regularity × Behaviour) — always global/unfiltered
- Volume matrix (same dimensions but shows total shipment attempts, not rider count)
- Expandable City → Hub → Rider tree
- Count/% toggle on table columns
- Filters: Behaviour tag, Regularity tag, search by rider name/ID

**Known quirk:** "Unmapped" is a valid city row — 9,150 riders belong to hubs not in `hub_mapping.csv`. They're deliberately shown, not hidden.

### 7.2 Rider Details (`/rider-details`)
**Data source:** `v_3mr_delivery` (3MR mode) or `sdd_awbs` direct (Overall mode) + `rider_daily` for raw productivity columns + `cpo` for earnings
**API:** `GET /api/details?date=today&mode=3mr&behaviour=X&regularity=Y`
**API (trend charts):** `GET /api/details/trend?mode=3mr&city=X`
**API (rider drilldown):** `GET /api/details/joined?riderId=X&start=YYYY-MM-DD&end=YYYY-MM-DD`

**Date presets:** Today, D-1 through D-7, L7D (last 7 days), L30D (last 30 days)

**SDD modes:**
- **3MR** (default): uses `v_3mr_delivery` — only AWBs received at hub ≥ 15:00
- **Overall**: uses `sdd_awbs` directly — all dispatched AWBs regardless of time

**What it shows:**
- KPI strip: Riders Active, Avg Attempt %, Avg Del %, Total Delivered, Avg Earnings, Avg Attempted/rider, Avg Delivered/rider
- Trend charts: L7D daily and L30D weekly views of riders / avg productivity / avg earnings
- Expandable City → Hub → Rider tree
- Per-rider columns: Assigned 3MR, Attempted, Delivered, Attempt%, Del%, Avg Earnings, Morning Avg Productivity, Evening Avg Productivity, Morning Runsheet Hour, Evening Runsheet Hour, Shift badge, Regularity badge
- Click rider row → expands to day-by-day drilldown table (from `/api/details/joined`)

**Drilldown:** Merges `rider_daily` and `v_3mr_delivery` per date. Shows morning/evening runsheet hours, attempt counts, and 3MR delivery stats side by side.

### 7.3 Rider Delivery (`/rider-delivery`)
**Data source:** `v_3mr_delivery` + `v_rider_summary` (for behaviour/regularity tags) + `hub_mapping`
**API:** `GET /api/delivery?date=today&behaviour=X&regularity=Y&prime=true`

**Date presets:** Today, D-1 through D-7, L7D, L30D

**What it shows:**
- KPI strip: Total 3MR Orders, Total Delivered, Overall DEL%, Total Breaches
- Expandable City → Hub → Rider tree with DEL%, Breach%, L7D Trend, L30D Trend columns
- Filters: Behaviour, Regularity, C2 Clients toggle, date preset

**Trend columns:** L7D and L30D DEL% delta vs prior period (computed in the delivery API). Always computed off `max_date`, independent of selected date preset.

### 7.4 Demand Data (`/demand`)
**Data source:** `v_3mr_delivery` + `hub_mapping` (city view) or `v_3mr_delivery` + `prime_clients` (client view)
**API:** `GET /api/demand?view=city&prime=true`

**Sub-views:**
- **City Level:** City → Hub tree. Columns: Total Demand, 3MR Demand, 3MR DEL%, vs D-1 trend, 7-day sparkline
- **Client Level:** Flat table. Columns: Client, C2 flag, Total AWBs, 3MR AWBs, Delivered, DEL%, vs D-1 trend, L7D Avg, 7-day sparkline

**"Total Demand" = `assigned_3mr + attempted_3mr`** — includes both 3MR assigned and non-3MR attempted AWBs from the view.

**Sparkline:** Last 7 days of daily `assigned_3mr` per city/client.

**L7D Avg (client view):** Average daily `assigned_3mr` over last 7 days.

### 7.5 Configuration (`/configuration`)
**Data source:** Browser `localStorage` only — no backend
**Provider:** `components/config-provider.tsx` (React context)

**Configurable parameters:**

| Parameter | Default | Affects |
|-----------|---------|---------|
| `morningEveningCutoff` | 15 | Login classification: hour dividing morning from evening |
| `analysisWindowDays` | 30 | Rider profiling window |
| `newRiderWindowDays` | 7 | New Rider classification window |
| `eveningRiderThreshold` | 80 | Min evening login % to be Evening Rider |
| `crossUtilEveningThreshold` | 70 | Min evening login % to be Cross Utilised |
| `regularThreshold` | 80 | Min login rate % to be Regular |
| `delPctGreenThreshold` | 80 | DEL% green colour cutoff |
| `delPctAmberThreshold` | 60 | DEL% amber colour cutoff |
| `mr3CutoffHour` | 15 | Hour at/after which AWBs are classified as 3MR |
| `attemptStatusCodes` | DELIVERED, CID, NOT_CONTACTABLE | Status codes counted as attempted |
| `breachFlagValues` | true, 1, yes | Values in `Breach` column counted as breach |

**Note:** Config changes update the UI immediately (React context) but do NOT update DuckDB views. The SQL views in DuckDB are hardcoded with the defaults. Config only affects frontend display logic (colour thresholds). A future improvement would be to pass config values as query params to APIs.

---

## 8. API Routes Reference

| Route | Params | Description |
|-------|--------|-------------|
| `GET /api/status` | — | DB health: max_date, total AWBs, total riders, recent ingests |
| `GET /api/profiling` | `behaviour`, `regularity` | Rider profiling tree + KPIs + 3×3 matrix |
| `GET /api/profiling/matrix` | `city`, `hub` | 3×3 rider count matrix (filtered) |
| `GET /api/profiling/volume-matrix` | `city`, `hub` | 3×3 shipment volume matrix |
| `GET /api/details` | `date`, `mode`, `behaviour`, `regularity` | Rider productivity + earnings tree |
| `GET /api/details/trend` | `mode`, `city` | L7D daily + L30D weekly trend charts |
| `GET /api/details/joined` | `riderId`, `start`, `end` | Per-rider day-by-day drilldown |
| `GET /api/delivery` | `date`, `behaviour`, `regularity`, `prime` | 3MR delivery performance tree + trend deltas |
| `GET /api/demand` | `view`, `prime` | Demand by city or client |

**Date preset values:** `today` | `d1`–`d7` | `l7d` | `l30d`
**Behaviour values:** `Evening Rider` | `Cross Utilised` | `Morning Rider`
**Regularity values:** `Regular` | `Irregular` | `New Rider`
**Mode values:** `3mr` | `overall`

---

## 9. Data Pipeline

```
raw_data.csv                          SDD_Data/May/SDD_Data_<N>May.csv
     │                                              │
     ▼                                              ▼
rider_daily (table)              sdd_awbs (table, one row per AWB)
     │                                              │
     ▼                                              ▼
v_rider_summary (view)           v_3mr_delivery (view, 3MR AWBs only)
     │                                              │
     ▼                                              ▼
/api/profiling                   /api/delivery + /api/demand + /api/details
     │                                              │
     ▼                                              ▼
Rider Profiling page             Rider Delivery + Demand Data + Rider Details pages
```

The two pipelines are **completely independent**. They share a `rider_id` key but are never joined in production queries. Cross-join works: `rider_daily.rider_id = sdd_awbs.rider_id` (after float suffix strip).

### Running Ingest

```bash
# Normal ingest (skips already-ingested SDD files)
node backend/ingest.js

# Force re-ingest all SDD files (clears ingest_log first)
node backend/ingest.js --force
# or:
npm run reingest

# Auto-watch folder for new SDD CSV drops
node backend/watcher.js
```

### Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `DUCKDB_PATH` | `./prime.duckdb` | Path to DuckDB file |
| `SDD_DATA_DIR` | `./SDD_Data/May` | Directory watched for SDD CSVs |
| `RAW_DATA_PATH` | `./raw_data.csv` | Path to rider daily data |
| `HUB_MAPPING_PATH` | `./hub_mapping.csv` | Hub → city mapping |
| `CPO_PATH` | `./CPO.csv` | City CPO rates |
| `PRIME_CLIENTS_PATH` | `./prime_clients.csv` | Prime client list |

---

## 10. Key Design Decisions and Gotchas

### 10.1 rider_id Format Mismatch
`rider_daily` stores rider_id as `"10082916"` (integer string). `sdd_awbs` originally stored it as `"10082916.0"` (float string). Fixed in `ingest.js` with `REGEXP_REPLACE(... '\\.0$', '')`. Any new code joining these tables should verify the format is consistent.

### 10.2 Unmapped Hubs
9,150 riders (out of 28,148) belong to hubs not in `hub_mapping.csv`. All queries use `COALESCE(city, 'Unmapped')` — never `WHERE city IS NOT NULL`. Silent NULL exclusion was an early bug that hid 32% of riders.

### 10.3 login_rate_pct Denominator
Always 30 (fixed calendar window), never COUNT(*) from rider_daily. The table only has rows for login days, so COUNT(*) would always equal login_days giving 100% for everyone.

### 10.4 Two Rider Tag Systems
- `login_behaviour_tag` — our derived classification from 30-day login history in `raw_data.csv`
- `rider_tag` — Shadowfax upstream tag on each SDD AWB (Dedicated / Cross utilised / Unidentified)

These measure different things and are not interchangeable. `rider_tag` from sdd_awbs is currently unused in the UI.

### 10.5 Configuration Is Frontend-Only
The Configuration page saves to `localStorage`. DuckDB views are hardcoded with default thresholds. If a user changes the DEL% green threshold to 90%, it only changes the cell colour on screen — the SQL queries don't recompute. For rider classification thresholds to actually change the data, `v_rider_summary` would need to be regenerated with new parameters.

### 10.6 Overall vs 3MR Mode
Rider Details has a 3MR / Overall toggle. In Overall mode, the API builds an inline CTE from `sdd_awbs` directly instead of using `v_3mr_delivery`. All metrics are re-aggregated from scratch — the view is not used. This means Overall mode shows all dispatched AWBs regardless of `received_at_hub_time`.

### 10.7 DuckDB Singleton
`backend/db.ts` maintains a process-global singleton via `globalThis.__primeDuckDb` to survive Next.js hot-reload. Read queries use a read-only connection; write queries (used only during ingest) use a separate read-write connection. The ingest script opens its own connection and closes it when done.

### 10.8 CPO City Name Sensitivity
`cpo.city` must match `hub_mapping.city` exactly (case and spelling). Mismatch causes NULL CPO and ₹0 earnings. Current mapping: `Bangalore` (not Bengaluru), `Bhubaneswar` (not Bhubneshwar).

---

## 11. Component Reference

| Component | File | Purpose |
|-----------|------|---------|
| `StatCard` | `components/stat-card.tsx` | KPI tile with optional accent colour and sub-label |
| `DelPctCell` | `components/del-pct-cell.tsx` | Colour-coded DEL% value (green/amber/red) |
| `BehaviourBadge` | `components/profile-badges.tsx` | Coloured pill for Evening/Cross Utilised/Morning tags |
| `RegularityBadge` | `components/profile-badges.tsx` | Coloured pill for Regular/Irregular/New Rider tags |
| `MatrixTable` | `components/matrix-table.tsx` | 3×3 Regularity × Behaviour rider count matrix |
| `VolumeMatrixTable` | `components/volume-matrix-table.tsx` | 3×3 matrix showing shipment volume (attempt counts) |
| `TrendDisplay` | `components/trend-display.tsx` | Up/down/flat trend arrow with percentage |
| `TrendCharts` | `components/trend-charts.tsx` | Recharts bar charts for L7D/L30D trend (Rider Details) |
| `RiderProfileCard` | `components/rider-profile-card.tsx` | Expanded rider detail card (Rider Profiling expand) |
| `RiderDrilldown` | `components/rider-drilldown.tsx` | Day-by-day table for a rider (Rider Details expand) |
| `TopNav` | `components/top-nav.tsx` | Navigation bar with tabs + data status badge |
| `KpiStripLive` | `components/kpi-strip-live.tsx` | Global KPI bar above nav (total demand, DEL%, data date) |
| `ConfigProvider` | `components/config-provider.tsx` | React context for configuration state (localStorage-backed) |

---

## 12. Invariants and Rules

These rules were learned through bugs and should never be violated:

1. **Always verify totals** — after any API change, cross-check KPI count vs `SELECT COUNT(*)` on source view.
2. **No silent NULL exclusions** — use `COALESCE(city, 'Unmapped')`, never `WHERE city IS NOT NULL`.
3. **No LIMIT on rider queries** — 28K riders is fast enough; limits cause confusing truncated data.
4. **Counts before percentages** — default display is raw numbers; % is secondary via toggle.
5. **login_rate_pct denominator is always 30** — never `COUNT(*)` from rider_daily.
6. **tabular-nums on all numeric cells** — prevents column width jitter.
7. **Alignment levels**: city rows use chevron + name; hub rows indent `pl-10`; rider rows indent `pl-16`.
8. **Data date always visible** — KPI strip and page subtitles must show current `max_date`.
9. **CPO city names must match hub_mapping exactly** — check spelling before adding new cities.
10. **rider_id joins need format check** — always verify `.0` suffix is stripped before joining `sdd_awbs` to `rider_daily`.

---

## 13. Suggested Future Improvements

These gaps were identified during development but deferred:

| Priority | Improvement | Notes |
|----------|-------------|-------|
| High | Wire configuration thresholds to API queries | Currently config only changes UI colours. Pass threshold values as query params so rider classifications actually update when config changes. |
| High | Add `rider_tag` (Shadowfax source tag) column to Rider Profiling UI | Already in `sdd_awbs`. Surface as filter + display column. |
| Medium | Cross-join profiling + delivery | Show DEL% alongside behaviour/regularity tags in Rider Profiling. Requires joining `v_rider_summary` and `v_3mr_delivery` on rider_id (format now consistent). |
| Medium | Alert when hub_mapping.csv is missing hubs | The "Unmapped" row grows silently. Show a warning in the UI when > N% of riders are unmapped. |
| Medium | Make 3MR cutoff hour dynamic | Currently hardcoded as `HOUR(received_at_hub_time) >= 15` in `v_3mr_delivery`. Should regenerate views from config value. |
| Low | Morning earnings | 1MR CPO would use `base_pay` instead of `total_pay`. Formula: `attempt_morning × base_pay`. |
| Low | Date range custom picker | Currently limited to presets (Today/D-1–D-7/L7D/L30D). Free-form start/end date would help for weekly ops reviews. |
| Low | Export to CSV/Excel | Each table view should have a download button. |
| Low | Mobile layout | Current design is desktop-first (1024px+). |
