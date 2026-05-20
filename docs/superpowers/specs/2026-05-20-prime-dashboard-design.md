# Prime Dashboard — Full Product Requirements Document

**Version:** 1.0 (Complete)
**Date:** 2026-05-20
**Status:** Approved — Ready for Implementation Planning

---

## 1. Product Overview

A clean, minimal, elegant fullstack web dashboard that surfaces rider-level intelligence from SDD (Same Day Delivery) operational data. Built for local-first use on macOS with optional cloud deployment to Vercel + Supabase.

### Design Philosophy
- Light mode, white/slate palette, professional and shareable
- Global KPI strip always visible above navigation
- Expandable tree tables (City → Hub → Rider) wherever hierarchy applies
- Every threshold and business rule configurable from the Configuration tab
- Zero manual steps after initial setup — drop a CSV file, data appears

---

## 2. Tech Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Frontend | Next.js 15 (App Router) + TypeScript | Latest standard, clean routing |
| UI Components | shadcn/ui + Tailwind CSS v4 | Polished, accessible, free |
| Charts | Recharts | Already proven in existing codebase |
| Database | DuckDB (local) | Purpose-built for analytical CSV queries, 10-100x faster than Postgres for aggregations |
| Cloud DB | Supabase Postgres (free tier) | Optional cloud sync for remote access |
| Data Ingest | Node.js folder watcher | Auto-ingests new SDD CSVs on file drop, zero manual steps |
| Deployment | Vercel (frontend) + Supabase (DB) | Both free tier, single `git push` deploy |

### Local Dev
- Single `npm run dev` starts both Next.js and the folder watcher
- Open `localhost:3000`

### Cloud Deploy
- Push to Vercel → frontend live
- Point to Supabase → data accessible from any device

---

## 3. Reference / Input Files

| File | Purpose |
|------|---------|
| `SDD_Data_<N>May.csv` | Primary operational data (~180K rows/day, 50+ columns) |
| `CPO.csv` | City-level Cost Per Order for Prime shipments (used for 3MR earnings calculation) |
| `prime_clients.csv` | List of Prime client names — matched against `client_name` in SDD data |
| `hub_mapping.csv` | Hub → City → Zone hierarchy for geographic grouping |

### Key SDD Fields Used
| Field | Usage |
|-------|-------|
| `rider_id` | Unique rider identifier |
| `rider_name` | Display name |
| `rider_tag` | Source tag: Dedicated / Cross utilised / Unidentified |
| `first_runsheet_time` | Proxy for login — rider logged in if this is non-null on a date |
| `ofd_time` | Out-for-delivery timestamp |
| `received_at_hub_time` | Used for 1MR/3MR classification |
| `latest_status` | DELIVERED / CID / NOT_CONTACTABLE / other |
| `Breach` | SLA breach flag |
| `hub` | Hub identifier |
| `city_id` | City identifier |
| `client_name` | Client name — matched against Prime clients list |

### Derived Fields (computed at ingest)
```
per_rider_per_day:
  date, rider_id, had_morning_login, had_evening_login, had_any_login

per_rider_summary (rolling window):
  rider_id, rider_name, hub, city_id,
  rider_tag,                    ← from source
  login_behaviour_tag,          ← derived: Evening Rider / Cross Utilised / Morning Rider
  regularity_tag,               ← derived: New Rider / Regular / Irregular
  total_days_in_window,
  days_with_any_login,
  days_with_morning_login,
  days_with_evening_login,
  login_rate_pct,
  evening_login_rate_pct,
  first_login_date,
  is_new_rider,
  attempt_productivity_pct,     ← 3MR attempted / 3MR assigned
  delivered_productivity_pct,   ← 3MR delivered / 3MR assigned
  avg_3mr_earnings              ← 3MR delivered × city CPO
```

---

## 4. Global Layout

### Global KPI Strip (above nav bar — always visible)
```
| Total Demand (Overall) | 3MR Delivered | Delivered % | Data Date: 19 May 2026, 18:50 |
```
- Persists across all tab views
- "Data Date" = timestamp of latest SDD file ingested
- Updates automatically when new file is dropped

### Top Navigation Bar
```
[Prime Dashboard]  [Rider Profiling] [Rider Details] [Rider Delivery] [Demand Data] [Configuration]
```
- Active tab highlighted
- Clean, no sidebar — full content width on all views

### Expandable Tree Table Pattern
Used on: Rider Profiling, Rider Details, Rider Delivery, Demand Data

```
▶ Mumbai            | 4,200 | 78% | ▲ 12%      ← City row (aggregated)
  ▶ BOM_Andheri     | 1,100 | 82% | ▲ 8%       ← Hub row (rollup), indented
      Rider A       |    45 | 91% |             ← Rider row (individual), indented
      Rider B       |    38 | 76% |
  ▶ BOM_Kurla       |   980 | 74% | ▼ 3%
▶ Delhi             | 3,800 | 81% | ▲ 5%
```
- City rows: aggregated totals
- Hub rows: hub-level rollups (indented level 1)
- Rider rows where applicable: individual data (indented level 2)
- All levels sortable within their tier
- Expand/collapse state persisted during session

---

## 5. View Specifications

---

### View 1 — Rider Profiling

**Purpose:** Classify every rider across two independent dimensions — Login Behaviour and Login Regularity.

#### 5.1.1 Login Definition
A rider is considered to have **logged in** on a date if they have ≥1 row with non-null `first_runsheet_time` on that date.
- **Morning login:** `hour(first_runsheet_time) < morning_evening_cutoff` (default: 15)
- **Evening login:** `hour(first_runsheet_time) >= morning_evening_cutoff` (default: 15)

#### 5.1.2 Analysis Window
- **Primary window:** Last `analysis_window_days` days (default: 30) ending on `max_date`
- **New Rider window:** Last `new_rider_window_days` days (default: 7) ending on `max_date`
- `max_date` = maximum date found across all loaded SDD CSV files

#### 5.1.3 Login Behaviour Classification (priority order)

| Tag | Condition |
|-----|-----------|
| **Evening Rider** | Morning logins = 0 AND evening login rate ≥ `evening_rider_threshold` (default 80%) |
| **Cross Utilised** | Morning logins ≥ 1 AND evening login rate ≥ `cross_util_evening_threshold` (default 70%) |
| **Morning Rider** | Everything else |

Evening Rider evaluated first. Output column: `login_behaviour_tag`.

#### 5.1.4 Regularity Classification (priority order)

| Tag | Condition |
|-----|-----------|
| **New Rider** | First ever login date within last `new_rider_window_days` of `max_date` |
| **Regular** | Not New AND login rate ≥ `regular_threshold` (default 80%) |
| **Irregular** | Not New AND login rate < `regular_threshold` |

Output column: `regularity_tag`.

#### 5.1.5 Summary Cards (top row)
Total Active Riders · Evening Riders (n, %) · Cross Utilised (n, %) · Morning Riders (n, %) · Regular (n, %) · Irregular (n, %) · New Riders (n, %)

#### 5.1.6 Filters
City (multi-select) · Hub (multi-select) · Login Behaviour Tag · Regularity Tag · Source Rider Tag (Dedicated / Cross utilised / Unidentified)

#### 5.1.7 Tree Table
- **City level:** City, Total Riders, Evening Riders %, Cross Utilised %, Regular %, Irregular %, New Riders %
- **Hub level:** Hub, Total Riders, Evening Riders %, Cross Utilised %, Regular %, Irregular %, New Riders %
- **Rider level:** Rider ID, Rider Name, Source Tag, Login Behaviour, Regularity, Login Rate %, Morning Logins, Evening Logins, First Login Date, Active Since (days)

Sort: any column. Default: City → Hub → Login Behaviour.

---

### View 2 — Rider Details

**Purpose:** Per-rider operational detail — logins, productivity, and 3MR earnings.

#### 5.2.1 Earnings Calculation
`3MR Earnings = 3MR Delivered Orders × CPO (city-level, from CPO.csv)`
Scope: 3MR only. Morning earnings out of scope for v1.

#### 5.2.2 Productivity Columns
- **Attempt Productivity %** = 3MR Attempted / 3MR Assigned Orders × 100
- **Delivered Productivity %** = 3MR Delivered / 3MR Assigned Orders × 100

#### 5.2.3 Summary Cards
Total Logins Today · Total Active Riders · Avg Attempt Productivity % · Avg Delivered Productivity % · Avg 3MR Earnings (₹)

#### 5.2.4 Filters
City · Hub · Date preset (D-1 = yesterday, D-5 = 5 days ago, custom range) · Login Behaviour · Regularity · Prime Clients toggle

#### 5.2.5 Tree Table
- **City level:** City, Total Riders Logged In, Avg Attempt Productivity %, Avg Delivered Productivity %, Total 3MR Delivered, Avg 3MR Earnings (₹)
- **Hub level:** Hub, Riders Logged In, Avg Attempt Productivity %, Avg Delivered Productivity %, Total 3MR Delivered, Avg 3MR Earnings (₹)
- **Rider level:** Rider Name, Rider ID, Login (Y/N), 3MR Assigned, 3MR Attempted, 3MR Delivered, Attempt Productivity %, Delivered Productivity %, 3MR Earnings (₹)

Sort: any column. Default: City → Hub → Delivered Productivity % desc.

---

### View 3 — Rider Delivery

**Purpose:** Delivery performance filtered by rider profile dimensions.

#### 5.3.1 Summary Cards
Total 3MR Orders · Total 3MR Delivered · Overall DEL% · Prime DEL% · Breach Count

#### 5.3.2 Filters
City · Hub · Date range · Login Behaviour (dropdown) · Regularity · Prime Clients toggle

#### 5.3.3 Tree Table
- **City level:** City, # 3MR Orders, # Delivered, DEL%, Breach Count, Breach %
- **Hub level:** Hub, # 3MR Orders, # Delivered, DEL%, Breach Count, Breach %
- **Rider level:** Rider Name, Rider ID, Behaviour Tag, Regularity Tag, # Orders, # Delivered, DEL%, Breach Count

Sort: any column. Default: City → Hub → DEL% asc (worst performers first).

---

### View 4 — Demand Data

**Purpose:** City and client level demand monitoring with trend indicators. The "wow" view.

#### 5.4.1 Sub-views (toggled)
- **City Level** (default)
- **Client Level**

#### 5.4.2 Uptick / Downtick Indicator
Compared to previous day (D-1):
- ▲ green + % if demand increased
- ▼ red + % if demand decreased
- — grey if flat (< 1% change)

#### 5.4.3 City Level — Tree Table
- **City level:** City, Zone, Total Demand, 3MR Demand, 3MR DEL%, Uptick/Downtick % vs D-1, Sparkline (7-day trend)
- **Hub level (expanded):** Hub, Total Demand, 3MR Demand, 3MR DEL%, Uptick/Downtick % vs D-1

#### 5.4.4 Client Level — Flat Table
Client Name, Prime Flag (✓/–), Total AWBs, 3MR AWBs, Delivered, DEL%, Uptick/Downtick % vs D-1

#### 5.4.5 Filters
Date range · City · Zone · Prime Clients toggle

#### 5.4.6 Visual Elements
- Sparkline trend line (7-day) on each city row
- Colour-coded DEL% cells (green ≥80%, amber 60–79%, red <60%) — consistent with existing Excel colour coding
- Uptick/Downtick badge: coloured pill with arrow + percentage

---

### View 5 — Configuration

**Purpose:** Single source of truth for all business rules and thresholds. Changes apply immediately across all views (no reload).

#### 5.5.1 Configurable Parameters

| Parameter | Label | Default | Validation |
|-----------|-------|---------|------------|
| `morning_evening_cutoff` | Morning / Evening Cutoff Hour | 15 | 0–23 |
| `analysis_window_days` | Analysis Window (days) | 30 | 1–365 |
| `new_rider_window_days` | New Rider Window (days) | 7 | 1–30 |
| `evening_rider_threshold` | Evening Rider — Min Evening Login % | 80 | 0–100 |
| `cross_util_evening_threshold` | Cross Utilised — Min Evening Login % | 70 | 0–100 |
| `regular_threshold` | Regular Rider — Min Login % | 80 | 0–100 |
| `attempt_status_codes` | Attempted Status Codes | DELIVERED, CID, NOT_CONTACTABLE | comma-separated list |
| `breach_flag_values` | Breach Flag Values | true, 1, yes | comma-separated list |
| `3mr_cutoff_hour` | 3MR Cutoff Hour (received_at_hub_time) | 15 | 0–23 |
| `del_pct_green_threshold` | DEL% Green Threshold | 80 | 0–100 |
| `del_pct_amber_threshold` | DEL% Amber Threshold | 60 | 0–100 |

#### 5.5.2 UX
- Grouped into sections: Rider Classification · Performance Thresholds · Data Rules
- Each parameter: label, current value input, description of what it controls
- Input validation with inline error messages
- "Reset to Defaults" button per section + global reset
- Settings persisted in browser localStorage (no backend required for v1)
- Changes reflected immediately across all tabs

---

## 6. Data Pipeline Architecture

```
SDD CSV files (local folder)
        ↓
  Node.js folder watcher
  (watches SDD_Data/ directory)
        ↓
  DuckDB ingest + transformation
  (prime.duckdb — local file)
        ↓
  Next.js API routes
  (/api/riders/profiling, /api/riders/details,
   /api/delivery, /api/demand, /api/config)
        ↓
  React frontend
  (localhost:3000)
        ↓ (optional)
  Supabase Postgres sync
  (aggregated data only — for cloud access)
```

### API Routes
| Route | View |
|-------|------|
| `GET /api/riders/profiling` | Rider Profiling |
| `GET /api/riders/details` | Rider Details |
| `GET /api/delivery` | Rider Delivery |
| `GET /api/demand/city` | Demand Data — City Level |
| `GET /api/demand/client` | Demand Data — Client Level |
| `GET /api/config` | Read configuration |
| `POST /api/config` | Write configuration |
| `GET /api/status` | Data freshness (last ingest timestamp) |

---

## 7. Glossary

| Term | Definition |
|------|------------|
| 1MR | First Milk Run — received_at_hub_time < cutoff (default 15:00) |
| 3MR | Third Milk Run — received_at_hub_time >= cutoff (default 15:00) |
| max_date | Maximum date across all loaded SDD CSV files |
| Login | Rider has ≥1 row with non-null first_runsheet_time on a date |
| Morning login | hour(first_runsheet_time) < morning_evening_cutoff |
| Evening login | hour(first_runsheet_time) >= morning_evening_cutoff |
| login_behaviour_tag | Derived: Evening Rider / Cross Utilised / Morning Rider |
| regularity_tag | Derived: New Rider / Regular / Irregular |
| Attempt Productivity % | 3MR Attempted / 3MR Assigned × 100 |
| Delivered Productivity % | 3MR Delivered / 3MR Assigned × 100 |
| 3MR Earnings | 3MR Delivered × city CPO (from CPO.csv) |
| CPO | Cost Per Order — city-level rate from CPO.csv |
| Prime Clients | Client names from prime_clients.csv, matched to client_name in SDD data |
| 3MR Assigned Orders | AWBs where ofd_time IS NOT NULL AND hour(received_at_hub_time) >= 3mr_cutoff_hour |
| Uptick/Downtick | % change in demand vs previous day (D-1) |
| DEL% | Delivered / Total Assigned × 100 |
| ATP% | Attempted / Total Assigned × 100 |

---

## 8. Out of Scope (v1)

- Morning earnings calculation (1MR CPO)
- User authentication / login
- Multi-user roles or permissions
- Push notifications or alerts
- Historical data beyond loaded CSV files
- Mobile responsive layout (desktop-first)
