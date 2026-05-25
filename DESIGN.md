# Prime Dashboard — Design Context

> **Read this before touching any UI code.** This document describes what the dashboard is, what every page does, and the design direction it should follow. Use it to make decisions that are consistent with the product's purpose and visual language.

---

## What This Product Is

A **last-mile control tower** for Shadowfax SDD (Same Day Delivery) operations. The primary user is an LM (Last-Mile) manager or VP who opens this dashboard several times a day to answer questions like:

- Are my riders showing up and working tonight?
- Which hubs are missing deliveries right now?
- Is my 3MR (3-Miss-Run) delivery rate healthy today vs last week?
- Which clients or cities are trending down?

This is a **decision-support tool**, not a reporting tool. Every design choice should help the user act faster, not just see more data.

**Future scope (design for extensibility, not implementation):**
- Rider hiring plan: recommend hiring targets per hub based on demand trends and rider churn
- Hub-level RCA (Root Cause Analysis) for SLA breaches: surface why a hub missed targets

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js (App Router) + TypeScript |
| Styling | Tailwind CSS v4 + custom CSS variables |
| Components | shadcn/ui (Radix primitives) |
| Charts | Recharts |
| Database | DuckDB (local) → migrating to Supabase Postgres |
| Fonts | Inter (body/UI) + JetBrains Mono (numbers/data) |

**Important:** This project uses Next.js with breaking changes from common training data. Always check `node_modules/next/dist/docs/` before writing any Next.js-specific code.

---

## Design Direction

### Philosophy

**Clean, minimal, professional. No dark theme. Ever.**

This dashboard is used in office settings, often shared on screens during standups, and sometimes screenshotted for leadership decks. It must look like a professional operations tool — not a developer tool.

- Light background, white cards, crisp data
- Orange (`#FF6200`) is the Shadowfax brand accent — use it sparingly for primary actions and active states only
- Data density matters: tables are the core UX, not charts
- Hierarchy and structure over decoration

### Design Tokens (globals.css)

```css
--background: #FAFBFD        /* page bg — very slightly cool white */
--surface: #ffffff            /* card/table bg */
--surface-hover: #f8f9fb      /* row hover */
--surface-active: #f1f3f7     /* pressed / selected */
--border: #E2E8F0             /* default border */
--border-light: #EEF2F7       /* subtle dividers */

--sfx-orange: #FF6200         /* primary brand accent */
--sfx-orange-d: #E85800       /* hover/active state */
--sfx-orange-l: #FF8534       /* lighter variant */
--sfx-orange-glow: rgba(255, 98, 0, 0.12)  /* bg tint */

--success: #059669  --success-bg: #ecfdf5
--warning: #d97706  --warning-bg: #fffbeb
--danger: #dc2626   --danger-bg: #fef2f2

--shadow-card: 0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.03)
--shadow-card-hover: 0 4px 12px rgba(0,0,0,0.07), 0 1px 3px rgba(0,0,0,0.04)
```

### Typography Rules

- **Labels / table headers**: 10–11px, uppercase, `tracking-wider`, `text-slate-400`
- **Body / table data**: 13px, Inter, `text-slate-700`
- **Numbers / metrics**: JetBrains Mono, `tabular-nums`, size varies by importance
- **KPI values**: 20–24px, bold, JetBrains Mono, color-matched to accent
- **Section titles**: 14–15px, semibold, `text-slate-800`

### Component Classes (already in globals.css — reuse, don't reinvent)

| Class | Use |
|-------|-----|
| `.card` | white bg, border, 12px radius, shadow |
| `.kpi-card` | stat card with left accent bar (use for KPI strips) |
| `.data-table` | sticky header, row hover, tabular nums |
| `.city-row` | light gray `#f8fafc` bg for city-level rows |
| `.grand-total` | bold, top border, for total rows |
| `.filter-bar` | horizontal filter container |
| `.filter-chip` | active filter pill with dismiss |
| `.btn-primary` | orange gradient CTA |
| `.btn-secondary` | light bg, gray, bordered |
| `.heatmap-green/amber/red` | `rgba` tint backgrounds for numeric cells |

### Micro-interactions (already wired — preserve them)

- `fadeInUp` on page load for cards
- `animate-count-up` on KPI values
- Active nav tab: orange animated underline
- Table row hover: `surface-hover` bg
- Skeleton loaders via `.shimmer` during data fetch

---

## Layout & Navigation

```
┌─────────────────────────────────────────────────────────────┐
│  [Logo] Prime Dashboard   [Rider Profile] [Daily Perf]      │
│                           [Delivery] [Allocation]  ⚙ 2h ago │
└─────────────────────────────────────────────────────────────┘
│  KPI Strip: Total Demand | 3MR Delivered | DEL% | Date      │
└─────────────────────────────────────────────────────────────┘
│  (page content)                                              │
```

- Top nav: sticky, `shadow-nav`, max-width 1600px
- KPI strip: always visible below nav, dark background (`slate-900`)
- Page content: `px-4 sm:px-6 py-5`, max-width 1600px, centered

**Nav tabs:**
1. Rider Profile (`/`)
2. Daily Perf (`/rider-perf-trend`)
3. Delivery (`/rider-delivery`)
4. Allocation (`/demand`)
5. Configuration (gear icon → slide-out drawer)

---

## Pages — What Each One Does

### 1. Rider Profile (`/`)

**Question it answers:** Who are my riders, when do they work, and how consistently do they show up?

**Data shown:**
- KPI cards: Total Riders, Evening %, Cross Utilised %, Morning %, Regular %, Irregular %, New Rider %
- Regularity × Behaviour matrix (L30D vs D-1): 3×3 grid showing rider count per classification cell
- Expandable tree table: City → Hub → Rider
  - Columns: City/Hub/Rider, Total Riders, Evening Count, Cross Count, Morning Count, Avg Morning Login Hr, Avg Evening Login Hr, Avg Morning ATP, Avg Evening ATP
- Rider drilldown: click a rider row to expand individual login history

**Filters:** Behaviour tag (Evening/Cross/Morning), Regularity tag (Regular/Irregular/New), Search by name/ID, Count vs % toggle

**Data source:** `/api/profiling`, `/api/profiling/matrix`, `/api/profiling/volume-matrix`

**Classification logic (important for design):**
- Analysis window: last 30 days (configurable)
- Evening Rider: 0 morning logins + ≥80% evening login rate
- Cross Utilised: ≥1 morning login + ≥70% evening login rate
- Morning Rider: everything else
- New Rider: first login within last 7 days
- Regular: login rate ≥80%

---

### 2. Daily Perf (`/rider-perf-trend`)

**Question it answers:** How are my riders performing day-by-day across the last 8 days?

**Data shown:**
- KPI cards: Riders Active, Avg Attempt %, Avg DEL%, Total Delivered, Avg 3MR Earnings, Avg Attempted, Avg Delivered
- TrendCharts component: 4 sortable tables showing 8-day history
  - Table 1: Riders Logged In per city/hub (D-1 through D-8, Week Avg, Delta)
  - Table 2: Avg Productivity (attempts/rider)
  - Table 3: Avg Earnings/Rider (₹)
  - Table 4: DEL% per city/hub
- Expandable city → hub hierarchy in each table

**Modes:** 3MR (SDD shipments received after 3PM) vs Overall (all SDD)

**Filters:** Behaviour, Regularity, Date preset (today/L7D/L30D)

**Data source:** `/api/details`, `/api/details/trend`

**Key metric definitions:**
- Attempt % = 3MR Attempted / 3MR Assigned × 100
- DEL% = 3MR Delivered / 3MR Assigned × 100
- Earnings = Delivered × city CPO rate (₹ per order)
- D-1 column highlighted orange; W-Avg column highlighted gray
- Delta = D-1 vs W-Avg (D2–D8), shown as ▲/▼ badge

---

### 3. Delivery (`/rider-delivery`)

**Question it answers:** How is my delivery rate and SLA breach rate today, this week, this month?

**Data shown:**
- KPI cards: Total 3MR Orders, Total Delivered, Overall DEL%, Total Breaches
- Expandable tree table: City → Hub → Rider
  - Columns: City/Hub/Rider, # Orders, # Delivered, DEL%, Breach Count, Breach %, 7D Trend, 30D Trend
- DEL% cells: heatmap tinted (green/amber/red backgrounds)
- Trend badges: ▲ green / ▼ red based on delta vs prior period

**Filters:** Behaviour, Regularity, Prime Clients toggle, Date preset

**Data source:** `/api/delivery`

**SLA breach:** An order is a breach when the delivery `breach` flag is set (configurable values: `true`, `1`, `yes`)

---

### 4. Allocation (`/demand`)

**Question it answers:** How much demand is coming in, and is it growing or shrinking?

**Two sub-views (toggle):**

**City Level:**
- KPI cards: Total Allocation, 3MR Allocation, Avg 3MR DEL%, Cities Trending ▲
- DemandTrendCharts: 3 tables (Total Allocation Overall, Total 3MR, DEL% 3MR) × 8 days
- City → Hub tree table: columns = City, Total Allocation, 3MR Allocation, 3MR DEL%, D-1 Δ, 7-day sparkline

**Client Level:**
- Same KPI cards but "Clients Trending ▲"
- Flat table: Client, C2 flag, Total AWBs, 3MR AWBs, Delivered, DEL%, D-1 Δ, Sparkline
- Client search

**Data source:** `/api/demand`, `/api/demand/trend`

**3MR definition:** AWB with `received_at_hub_time` hour ≥ 15 (configurable `mr3CutoffHour`)

---

### 5. Configuration (slide-out drawer from ⚙ icon)

**Three sections:**

1. **Rider Classification** — morningEveningCutoff (15), analysisWindowDays (30), newRiderWindowDays (7), eveningRiderThreshold (80%), crossUtilEveningThreshold (70%), regularThreshold (80%)
2. **Performance Thresholds** — delPctGreenThreshold (80%), delPctAmberThreshold (60%)
3. **Data Rules** — mr3CutoffHour (15), attemptStatusCodes, breachFlagValues

Config is stored in localStorage and propagates via React context. `configVersion` counter triggers re-fetch on all pages.

---

## Key Components — Don't Break These

### `StatCard` (`components/stat-card.tsx`)
KPI metric card. Props: `label`, `value`, `sub`, `accent` ('default'|'green'|'amber'|'red'|'sky'|'purple'|'orange'). Uses `.kpi-card` + left accent bar. Always use this for KPI strips.

### `DelPctCell` (`components/del-pct-cell.tsx`)
Color-coded DEL% cell. `showBackground={true}` enables heatmap tint. Uses config thresholds. Use this — don't inline the color logic.

### `TrendDisplay` (`components/trend-display.tsx`)
Trend badge (▲/▼/—). Two variants: `pill` (with icon + magnitude) and `inline` (signed delta). Green = up, Red = down. Use for all trend comparisons.

### `ProfileBadges` (`components/profile-badges.tsx`)
`BehaviourBadge` and `RegularityBadge` pill components. Colors are fixed by classification — don't change them.

### `MatrixTable` (`components/matrix-table.tsx`)
3×3 Regularity × Behaviour matrix. Two side-by-side: L30D all riders + D-1 logged-in. Has city/hub filter dropdowns. Count vs volume toggle.

### `TrendCharts` (`components/trend-charts.tsx`)
8-day trend tables with expandable city → hub rows. Sortable columns. D-1 highlighted orange, W-Avg gray, vs-Avg delta chips.

### `DemandTrendCharts` (`components/demand-trend-charts.tsx`)
Same pattern as TrendCharts but for allocation data (3 metric variants).

### `TopNav` (`components/top-nav.tsx`)
Sticky nav with animated tab underline, data freshness chip, settings gear → opens ConfigDrawer.

### `ConfigDrawer` (`components/config-drawer.tsx`)
420px slide-in drawer from right. "Instant" vs "Next Ingest" latency labels per field. Two-step reset confirmation.

---

## Data Hierarchy Pattern (universal)

Every table on this dashboard follows the same expand pattern:

```
▶ Mumbai          [city row — gray bg, bold, hub count badge]
  ▶ Andheri Hub   [hub row — white bg, indented 20px]
      Rider Name  [rider row — white bg, indented 40px, smaller text]
  ▶ Bandra Hub
  ...
▶ Delhi
  ...
────────────────────────────
  All India       [grand total row — bold, top border]
```

- City rows: `.city-row` class, chevron icon, hub count badge
- Hub rows: `pl-5` indent, normal weight
- Rider rows: `pl-10` indent, smaller text, behaviour/regularity badges
- Grand total: `.grand-total` class, always last

---

## DEL% Color Logic (universal)

All DEL% values follow this rule — use `DelPctCell` component:

| Value | Color | Heatmap bg |
|-------|-------|-----------|
| ≥ 80% (configurable) | `text-emerald-600` | `.heatmap-green` |
| ≥ 60% (configurable) | `text-amber-600` | `.heatmap-amber` |
| < 60% | `text-red-600` | `.heatmap-red` |

---

## What Good Looks Like

A page is well-designed when:

1. **The most important number is the biggest thing on the page.** KPI cards at top, big bold numbers, colored by status.
2. **Problems are obvious without reading.** Red cells, down-arrows, and breach counts should stand out immediately. Healthy = quiet, unhealthy = loud.
3. **The table is scannable.** Alternating row tints only if needed, sticky column headers, compact row height (no wasted whitespace), numbers right-aligned.
4. **Filters are always visible.** Never hide them in a drawer — they're used constantly.
5. **Export is one click away.** Every table has a CSV export button.
6. **Data freshness is always visible.** "2h ago" chip in the nav. Never let the user wonder if the data is stale.

---

## What to Avoid

- **Dark backgrounds** on page content (the KPI strip is the only exception — it's intentional)
- **Animations that delay data display** — load skeleton → data, not spinners that block the layout
- **Color for decoration** — color means status (green=good, amber=warn, red=bad, orange=brand action)
- **Empty states without explanation** — if a filter returns nothing, say why
- **Inconsistent table column widths** — name columns are text-left, metric columns are text-right
- **Putting charts where tables would be clearer** — this audience reads numbers, not shapes
- **Truncating metric values** — always show full numbers; use compact notation only as a last resort (e.g., "12.4K" only if column is very narrow)

---

## Future Scope (Don't Build Yet, But Don't Block)

These features are planned for later phases. Design new components to leave room for them without implementing them:

1. **Rider Hiring Plan** — Per-hub recommendation: how many riders to hire based on demand trend + current churn rate. Will likely appear as a new tab or section under Rider Profile.

2. **Hub RCA for SLA Breach** — Drill into a hub's breach events: what caused them? (Rider shortage? Late pickups? High volume spike?) Will likely be a drilldown from the Delivery page, expanding a hub row into a cause breakdown.

Both features will need the same data hierarchy and design patterns already established. Don't use patterns that make City → Hub → Rider expansion harder.
