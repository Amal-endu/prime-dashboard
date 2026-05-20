# Prime Dashboard — User Guide

Prime Dashboard is an internal operations tool for monitoring SDD (Same-Day Delivery) performance. It ingests two data pipelines — rider login data and SDD AWB data — and surfaces them across five views.

---

## Navigation

The top navigation bar has five tabs:

| Tab | What it shows |
|-----|---------------|
| **Rider Profiling** | 30-day login behaviour and regularity classification for all riders |
| **Rider Details** | Per-rider 3MR productivity and earnings for a selected date range |
| **Rider Delivery** | 3MR delivery performance with date selector, breach tracking, and L7D/L30D trends |
| **Demand Data** | City-level and client-level 3MR demand with sparklines and D-1 trend |
| **Configuration** | View the underlying data configuration (CPO rates, hub mapping, prime clients) |

A **KPI strip** at the top of every page shows the latest date's headline numbers: active riders, 3MR orders, DEL%, and breaches.

---

## Data Sources

### raw_data.csv → Rider Profiling
Daily rider login records. Each row is one rider on one date.

Fields used: `rider_id`, `hub`, `morning_runsheet_hour`, `evening_runsheet_hour`, `attempted_shipment`

The dashboard aggregates the last 30 days from this file to compute login rates and behaviour tags.

### SDD_Data_*.csv → Rider Delivery, Rider Details, Demand Data
One file per day. Each row is one AWB (shipment).

Fields used: `awb_number`, `rider_id`, `hub`, `client_name`, `rider_tag`, `latest_status`, `received_at_hub_time`, `ofd_time`, `first_runsheet_time`, `breach`

3MR shipments are identified by `received_at_hub_time >= 15:00` (received at hub after 3 PM).

---

## Rider Profiling

**Purpose:** Understand how riders are distributed across login behaviour and regularity categories.

### Classification Tags

**Login Behaviour** (based on the last 30 days of login data):
- **Evening Rider** — Never had a morning login AND evening login rate ≥ 80%
- **Cross Utilised** — Had at least one morning login AND evening login rate ≥ 70%
- **Morning Rider** — Everyone else (primarily logs in for morning runs)

**Regularity** (based on the last 30 days):
- **Regular** — Login rate ≥ 80% of days in the window
- **Irregular** — Login rate < 80%
- **New Rider** — First ever login was within the last 7 days

### Tree Table
Rows are grouped **City → Hub → Rider**. Click any city or hub row to expand it.

Click a **rider row** to open a detail card showing: identity info, login activity with a visual progress bar, and classification breakdown.

### Count / % Toggle
Default view shows **raw counts** (e.g. "142 Evening Riders"). Toggle to **%** to see each count as a percentage of that row's total riders. City and hub % are computed from their own totals, not the grand total.

### Grand Total Row
Always shown at the bottom of the table. When in % mode, percentages are re-derived from the summed counts (not averaged across cities).

### Sorting
Click any column header to sort cities. Click again to reverse direction.

### Filters
- **Search** — Filter by rider name or ID (filters the rider rows; city/hub rows only appear if they contain matching riders)
- **Behaviour** / **Regularity** — Dropdown filters applied server-side; city and hub subtotals reflect the filtered set
- **Clear filters** — Appears when any filter is active

### Unmapped Riders
Riders whose hub is not in `hub_mapping.csv` appear under the **Unmapped** city group. This is a data quality signal — if you see a large Unmapped group, check whether new hubs need to be added to `hub_mapping.csv`.

---

## Rider Details

**Purpose:** Productivity and earnings view for riders who performed 3MR deliveries, crossed with their profiling classification.

### Date Presets
| Preset | Shows |
|--------|-------|
| Today | Latest available date |
| D-1 | One day before latest date |
| D-5 | Five days before latest date |
| Last 7 days | Latest 7-day window (aggregated) |
| Last 30 days | Latest 30-day window (aggregated) |

### Columns
- **Riders Active** — Number of riders who had at least one 3MR AWB in the period
- **Assigned 3MR** — Total AWBs received at hub after 3 PM
- **Attempted** — AWBs with status DELIVERED, CID, or NOT_CONTACTABLE
- **Delivered** — AWBs with status DELIVERED
- **Attempt Prod%** — Attempted / Assigned × 100
- **Delivery Prod%** — Delivered / Assigned × 100
- **Earnings** — Delivered × CPO rate for that city

### Tree Table
City → Hub → Rider. Expand cities to see hub rollups, expand hubs to see individual riders.

Behaviour and Regularity tags come from the 30-day profiling window and are cross-joined onto the delivery data. A rider who appears in delivery but not in raw_data will show default tags.

---

## Rider Delivery

**Purpose:** Daily delivery performance with breach tracking and week/month trend comparison.

### Date Selector
Ten presets in the filter bar (right side):

| Preset | Data shown |
|--------|-----------|
| Today | Latest ingested date only |
| D-1 through D-7 | That specific day (one day at a time) |
| L7D | Last 7 days aggregated |
| L30D | Last 30 days aggregated |

### Trend Columns
Both trend columns are always computed from the full dataset regardless of the selected date preset.

- **L7D Trend** — DEL% for the last 7 days vs the 7 days before that. Shows the delta in percentage points (pp). Green = improvement, Red = decline.
- **L30D Trend** — Same but 30-day vs previous 30-day window.

Example: `+2.3pp` means DEL% improved by 2.3 percentage points compared to the prior period.

### Breaches
A breach is an AWB flagged as `breach = TRUE` in the SDD data. This is set upstream by the Shadowfax system (not computed by this dashboard).

Note: May 19 shows 0 breaches because the only breach that day was a morning-run AWB (received at 7:44 AM), which is excluded from the 3MR filter. This is correct behaviour.

### Filters
- **Behaviour / Regularity** — Same server-side filters as Rider Profiling
- **Prime Only** — Restricts all rows to AWBs from Prime clients only

### Sort
Click any column header to sort city rows. Hub and rider rows sort within their parent in the order returned by the server.

---

## Demand Data

**Purpose:** Volume and delivery rate overview at city and client level, with D-1 comparison and 7-day sparklines.

### City Level vs Client Level
Toggle between views using the **City Level / Client Level** pill at the top right.

#### City Level
- Rows are cities, expandable to hubs
- **Total Demand** — Sum of assigned + attempted AWBs (all SDD, not just 3MR)
- **3MR Demand** — AWBs received at hub after 3 PM
- **3MR DEL%** — Delivered / 3MR assigned × 100
- **vs D-1** — 3MR demand change from the previous day (volume change, not DEL%)
- **7-Day Trend** — Sparkline of 3MR demand over the last 7 days
- **Filters:** Prime Only toggle, sort on any numeric column

#### Client Level
- One row per client, flat list
- **Total AWBs** — All AWBs for that client
- **3MR AWBs** — 3MR-eligible AWBs
- **Delivered** — Delivered count
- **DEL%** — Delivered / 3MR × 100
- **vs D-1** — 3MR AWB volume change from previous day
- **Filters:** Search by client name, Prime Only toggle, sort on any column
- **Prime badge** — Clients in `prime_clients.csv` are marked with a gold Prime badge

Both views show a **Grand Total row** at the bottom. DEL% in the grand total is re-derived from summed counts, not averaged.

---

## Configuration

Shows the reference data currently loaded:

- **CPO Rates** — Cost Per Order by city (base pay, SDD pay, total). Used to compute rider earnings in Rider Details.
- **Hub Mapping** — Hub → Zone → City mapping. Hubs not in this file appear as "Unmapped".
- **Prime Clients** — List of clients marked as Prime. Used for Prime Only filters.

---

## Data Freshness

The KPI strip and all page subtitles show the **data date** — the most recent date present in the database. If this date is stale (e.g. yesterday's data is not showing today), the SDD CSV for that date has not been ingested yet.

To ingest new data:
```bash
npm run ingest      # ingest only new files
npm run reingest    # force re-ingest all files (use after changing CPO.csv or hub_mapping.csv)
```

---

## Glossary

| Term | Definition |
|------|-----------|
| 3MR | Third Mile Run — evening delivery run for AWBs received at hub after 3 PM |
| AWB | Air Waybill — unique shipment identifier |
| DEL% | Delivery percentage: Delivered / Assigned × 100 |
| Breach | AWB that breached its SLA (flagged upstream by Shadowfax) |
| CPO | Cost Per Order — per-city payout rate for delivered AWBs |
| Hub | Local delivery station |
| Pod | Group of hubs within a zone |
| Zone | Geographic grouping of hubs within a city |
| Prime | Client listed in prime_clients.csv — eligible for Prime-Only filter |
| L7D | Last 7 days (rolling window ending on latest available date) |
| L30D | Last 30 days (rolling window ending on latest available date) |
| D-1 | One calendar day before the latest available date |
| pp | Percentage points — used for trend deltas (e.g. +2pp means the rate went from 78% to 80%) |
