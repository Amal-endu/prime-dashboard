# Rider ID Integer Migration & Matrix Data Flow

## Question 1: Using Integer Values for Rider ID

### Current State: TEXT (VARCHAR)
```sql
-- Currently in sql/schema.sql
CREATE TABLE rider_daily (
  rider_id TEXT NOT NULL,  -- ❌ TEXT type
  ...
);

CREATE TABLE rider_day_shipments (
  rider_id TEXT NOT NULL,  -- ❌ TEXT type
  ...
);
```

### Why Change to INTEGER?
1. **Performance**: Integer comparisons faster than string comparisons
2. **Storage**: 4 bytes (INT) vs 4-50 bytes (TEXT) depending on string length
3. **Indexing**: Integer indexes are more efficient
4. **Data Integrity**: Prevents invalid IDs (e.g., "abc123xyz")
5. **Type Safety**: Compile-time validation

### Migration Plan (3 Steps)

#### Step 1: Add Integer Column to All Tables
```sql
-- Add new integer column to all tables
ALTER TABLE rider_daily 
ADD COLUMN rider_id_int INT;

ALTER TABLE rider_day_shipments 
ADD COLUMN rider_id_int INT;

-- Add any other tables:
ALTER TABLE rider_atp ADD COLUMN rider_id_int INT;
-- etc...
```

#### Step 2: Populate with Data
```sql
-- Populate the new integer column from text column
UPDATE rider_daily 
SET rider_id_int = CAST(rider_id AS INT) 
WHERE rider_id ~ '^\d+$';  -- Only valid numeric strings

-- Check for non-numeric IDs (will fail to convert)
SELECT DISTINCT rider_id FROM rider_daily 
WHERE rider_id !~ '^\d+$'
LIMIT 10;
```

#### Step 3: Swap Columns
```sql
-- Once data is migrated and validated:
ALTER TABLE rider_daily DROP COLUMN rider_id;
ALTER TABLE rider_daily RENAME COLUMN rider_id_int TO rider_id;
ALTER TABLE rider_daily ALTER COLUMN rider_id SET NOT NULL;

-- Re-create primary key and indexes
ALTER TABLE rider_daily 
DROP CONSTRAINT rider_daily_pkey;

ALTER TABLE rider_daily 
ADD PRIMARY KEY (date, rider_id);

-- Recreate indexes with INT type
CREATE INDEX rider_daily_rider_idx ON rider_daily (rider_id, date DESC);
```

### Updated Schema (After Migration)
```sql
CREATE TABLE IF NOT EXISTS rider_daily (
  date                   DATE    NOT NULL,
  rider_id               INT     NOT NULL,  -- ✅ Changed to INT
  hub                    TEXT    NOT NULL,
  rider_name             TEXT,
  morning_runsheet_hour  SMALLINT,
  evening_runsheet_hour  SMALLINT,
  attempt_morning        INTEGER,
  attempt_evening        INTEGER,
  attempted_total        INTEGER,
  PRIMARY KEY (date, rider_id)
);
CREATE INDEX rider_daily_rider_idx ON rider_daily (rider_id, date DESC);

CREATE TABLE IF NOT EXISTS rider_day_shipments (
  date                  DATE    NOT NULL,
  rider_id              INT     NOT NULL,  -- ✅ Changed to INT
  hub                   TEXT    NOT NULL,
  assigned_3mr          INTEGER NOT NULL DEFAULT 0,
  attempted_3mr         INTEGER NOT NULL DEFAULT 0,
  delivered_3mr         INTEGER NOT NULL DEFAULT 0,
  breach_count_3mr      INTEGER NOT NULL DEFAULT 0,
  assigned_overall      INTEGER NOT NULL DEFAULT 0,
  attempted_overall     INTEGER NOT NULL DEFAULT 0,
  delivered_overall     INTEGER NOT NULL DEFAULT 0,
  breach_count_overall  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (date, rider_id, hub)
);
CREATE INDEX rider_day_ship_rider_idx ON rider_day_shipments (rider_id, date DESC);
```

### Code Changes Required

#### In backend/ingest.js
```javascript
// OLD: Text conversion
const riderId = (r.rider_id || '').trim()
params.push(riderId)

// NEW: Integer conversion with validation
const riderId = parseInt((r.rider_id || '').trim(), 10)
if (isNaN(riderId)) {
  validationErrors.push({ row: r, error: 'invalid rider_id, must be numeric' })
  continue
}
params.push(riderId)
```

#### In app/api/profiling/route.ts
```typescript
// OLD: Query returns text rider_id
const riders = riderRows.map(r => ({
  riderId: r.rider_id as string,  // ❌ String
  ...
}))

// NEW: Query returns integer rider_id
const riders = riderRows.map(r => ({
  riderId: Number(r.rider_id),    // ✅ Integer
  ...
}))
```

#### In lib/types.ts
```typescript
export interface RiderData {
  riderId: number;    // ✅ Changed from string to number
  riderName: string;
  hub: string;
  // ... rest of fields
}
```

---

## Question 2: Where Does the Regularity × Behaviour Matrix Data Come From?

### Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│ PostgreSQL Database (rider_daily + rider_day_shipments)     │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ app/api/profiling/route.ts (GET /api/profiling)             │
│                                                              │
│  Step 1: Classify riders using CTE 'classified'             │
│  ├─ Window: last 30 days (configurable)                     │
│  ├─ Source: rider_daily table                               │
│  ├─ Logic:                                                  │
│  │  • Count login days (morning/evening)                    │
│  │  • Calculate login_behaviour_tag:                        │
│  │    - Evening Rider: 0 morning + ≥80% evening logins     │
│  │    - Cross Utilised: >0 morning + ≥70% evening logins   │
│  │    - Morning Rider: default                              │
│  │  • Calculate regularity_tag:                             │
│  │    - New Rider: active < 7 days (configurable)          │
│  │    - Regular: login_rate ≥ 80%                          │
│  │    - Irregular: default                                  │
│  └─ Output: rider_summary CTE with classifications          │
│                                                              │
│  Step 2: Query the matrix                                   │
│  ├─ Source: rider_summary CTE (from Step 1)                 │
│  ├─ Query:                                                  │
│  │   SELECT regularity_tag, login_behaviour_tag, COUNT(*)   │
│  │   FROM rider_summary                                      │
│  │   GROUP BY regularity_tag, login_behaviour_tag            │
│  │   ORDER BY regularity_tag, login_behaviour_tag            │
│  └─ Returns: 9 cells (3 regularity × 3 behaviour types)    │
│                                                              │
│  Step 3: Format for frontend                                │
│  ├─ Converts to matrix structure:                           │
│  │   {                                                       │
│  │     Regular: { evening: 0, cross: 0, morning: 0, total} │
│  │     Irregular: { evening: 5, cross: 2, morning: 10 }    │
│  │     NewRider: { ... }                                    │
│  │   }                                                       │
│  └─ Returns in JSON response                                │
└─────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ Frontend (app/page.tsx → MatrixTable Component)             │
│                                                              │
│  Data received as: matrix property in ApiData                │
│  Matrix stored in state as: Record<string, MatrixCell>      │
│  Rendered as: HTML table with classification counts         │
└─────────────────────────────────────────────────────────────┘
```

### Detailed Query Breakdown

```sql
-- The complete flow from raw data to matrix

-- INPUT: rider_daily table (one row per rider per day)
SELECT * FROM rider_daily LIMIT 1;
-- Result:
-- date: 2026-05-24, rider_id: 12345, hub: 'BOM-001'
-- morning_runsheet_hour: 7, evening_runsheet_hour: NULL

-- STEP 1: CLASSIFICATION (in profiling/route.ts line 275-295)
WITH cfg AS (
  SELECT 30 AS window_days, 7 AS new_rider_days, 80 AS evening_threshold
),
anchor AS (SELECT '2026-05-24'::DATE AS anchor_date),
rider_window AS (
  SELECT
    rd.rider_id,
    CASE WHEN rd.morning_runsheet_hour IS NOT NULL THEN 1 ELSE 0 END AS had_morning_login,
    CASE WHEN rd.evening_runsheet_hour IS NOT NULL THEN 1 ELSE 0 END AS had_evening_login
  FROM rider_daily rd
  WHERE rd.date BETWEEN '2026-04-24' AND '2026-05-24'  -- Last 30 days
),
agg AS (
  SELECT
    rider_id,
    SUM(had_morning_login) AS morning_login_days,
    SUM(had_evening_login) AS evening_login_days
  FROM rider_window
  GROUP BY rider_id
),
classified AS (
  SELECT
    a.rider_id,
    CASE
      WHEN morning_login_days = 0 AND evening_login_days > 0
        THEN 'Evening Rider'              -- No morning, has evening
      WHEN morning_login_days > 0 AND (evening_login_days::FLOAT / (morning_login_days + evening_login_days) >= 0.7)
        THEN 'Cross Utilised'            -- Has both, evening ≥ 70%
      ELSE 'Morning Rider'               -- Default
    END AS login_behaviour_tag,
    
    CASE
      WHEN active_since_days <= 7
        THEN 'New Rider'
      WHEN login_rate >= 80
        THEN 'Regular'
      ELSE 'Irregular'
    END AS regularity_tag
  FROM agg a
)
SELECT * FROM classified LIMIT 5;
-- Result:
-- rider_id: 12345, login_behaviour_tag: 'Evening Rider', regularity_tag: 'Regular'
-- rider_id: 12346, login_behaviour_tag: 'Cross Utilised', regularity_tag: 'Irregular'
-- rider_id: 12347, login_behaviour_tag: 'Morning Rider', regularity_tag: 'New Rider'
-- ...

-- STEP 2: MATRIX QUERY (in profiling/route.ts line 288-295)
SELECT 
  regularity_tag, 
  login_behaviour_tag, 
  COUNT(*) AS n
FROM rider_summary  -- ← rider_summary is the 'classified' CTE output
GROUP BY regularity_tag, login_behaviour_tag
ORDER BY regularity_tag, login_behaviour_tag;

-- Result:
-- regularity_tag | login_behaviour_tag | n
-- ───────────────┼─────────────────────┼─────
-- Irregular      | Cross Utilised      | 8,502
-- Irregular      | Evening Rider       | 4,200
-- Irregular      | Morning Rider       | 4,651
-- New Rider      | Cross Utilised      | 230
-- New Rider      | Evening Rider       | 145
-- New Rider      | Morning Rider       | 1,530
-- Regular        | Cross Utilised      | 1,477
-- Regular        | Evening Rider       | 2,489
-- Regular        | Morning Rider       | 1,207

-- STEP 3: JAVASCRIPT PROCESSING (in profiling/route.ts line 296-308)
const matrix = {
  Regular:   { evening: 2489, cross: 1477, morning: 1207, total: 5173 },
  Irregular: { evening: 4200, cross: 8502, morning: 4651, total: 17353 },
  'New Rider': { evening: 145, cross: 230, morning: 1530, total: 1905 }
}

-- STEP 4: FRONTEND RENDERING (app/page.tsx line ~120)
const { matrix } = data
// Renders as HTML table:
// Behaviour ↓ | Regular | Irregular | New Rider | Row %
// ─────────────┼─────────┼───────────┼──────────┼──────
// Evening      | 2489    | 4200      | 145      | 
// Cross Util   | 1477    | 8502      | 230      |
// Morning      | 1207    | 4651      | 1530     |
```

### Key Data Sources for Matrix

| Component | Source Table | Filter |
|-----------|--------------|--------|
| **Classification Logic** | `rider_daily` | Last 30 days (configurable: `analysis_window_days`) |
| **Login Behaviour Tags** | rider login hours in `rider_daily` | Morning vs Evening cutoff at 15:00 (configurable: `mr3CutoffHour`) |
| **Regularity Tags** | Login frequency + first login date | New = < 7 days old (configurable: `new_rider_window_days`) |
| **Count (n)** | Count of distinct riders | Post-classification, grouped by tags |

### Configuration Parameters Affecting Matrix

These parameters in `/configuration` page change the matrix:

```typescript
// From lib/config-params.ts
analysis_window_days: 30        // How many days back to look for login behavior
new_rider_window_days: 7        // Days back to flag as "New Rider"
evening_threshold: 80           // % evening logins needed for "Evening Rider"
cross_threshold: 70             // % evening logins needed for "Cross Utilised"
regular_threshold: 80           // % login rate needed for "Regular"
```

If you change these → matrix cells change → classification changes → all downstream metrics change

### Why It's in profiling/route.ts and Not Elsewhere

1. **profiling/route.ts** = `/api/profiling` endpoint
2. Called on page load with: `GET /api/profiling?windowDays=30&newRiderDays=7&...`
3. Returns: `{ kpi, matrix, cities, hubs, riders }`
4. Frontend receives in app/page.tsx and stores in `data` state
5. MatrixTable component renders from `data.matrix`

### The "Two Matrices" on the Dashboard

You see **TWO matrices** on the Rider Profile page:
1. **"L30D — All Riders"** (Top)
   - Source: All riders classified with last 30 days data
   - Query: `FROM rider_summary` (no filter)
   
2. **"D-1 — Logged In (25 May)"** (Bottom)
   - Source: Only riders who logged in yesterday
   - Query: `FROM rider_summary WHERE <riders who logged in yesterday>`

Both use the same classification logic but different rider populations.

---

## Implementation Checklist

### For Integer Rider ID Migration
- [ ] Step 1: Add `rider_id_int` column to all tables
- [ ] Step 2: Populate from existing TEXT `rider_id`
- [ ] Step 3: Validate no non-numeric IDs
- [ ] Update backend/ingest.js to convert to INT
- [ ] Update all SQL queries to use INT type
- [ ] Update TypeScript types (lib/types.ts)
- [ ] Update API responses to return INT
- [ ] Test with sample data
- [ ] Drop old TEXT `rider_id` column
- [ ] Commit changes: "migration: change rider_id from TEXT to INT"

### For Matrix Data Verification
- [ ] Run the matrix SQL query directly in psql
- [ ] Compare frontend values with database query
- [ ] Verify counts match across all 9 cells
- [ ] Test with different config parameters
- [ ] Check "All Riders" vs "Logged In Today" matrices

