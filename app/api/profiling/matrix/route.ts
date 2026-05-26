export const runtime = 'nodejs'
export const revalidate = 300
import { NextResponse } from 'next/server'
import { query } from '@/lib/supabase/sql'
import { apiError, parseParamString, parseThreshold, parseWindowDays } from '@/lib/validators'

type MatrixCell = { evening: number; cross: number; morning: number; total: number }
type Matrix = Record<string, MatrixCell>

function emptyMatrix(): Matrix {
  return {
    Regular:     { evening: 0, cross: 0, morning: 0, total: 0 },
    Irregular:   { evening: 0, cross: 0, morning: 0, total: 0 },
    'New Rider': { evening: 0, cross: 0, morning: 0, total: 0 },
  }
}

function buildMatrix(rows: { regularity_tag: string; login_behaviour_tag: string; n: number }[]): Matrix {
  const m = emptyMatrix()
  for (const r of rows) {
    const reg = r.regularity_tag
    const beh = r.login_behaviour_tag
    const n = Number(r.n)
    if (!m[reg]) m[reg] = { evening: 0, cross: 0, morning: 0, total: 0 }
    if (beh === 'Evening Rider')       m[reg].evening = n
    else if (beh === 'Cross Utilised') m[reg].cross = n
    else if (beh === 'Morning Rider')  m[reg].morning = n
    m[reg].total += n
  }
  return m
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  try {
    const city   = parseParamString(searchParams.get('city'), 'city')
    const hub    = parseParamString(searchParams.get('hub'), 'hub')

    const windowDays       = parseWindowDays(searchParams.get('windowDays'),       30)
    const newRiderDays     = parseWindowDays(searchParams.get('newRiderDays'),       7)
    const eveningThreshold = parseThreshold(searchParams.get('eveningThreshold'),   80)
    const crossThreshold   = parseThreshold(searchParams.get('crossThreshold'),     70)
    const regularThreshold = parseThreshold(searchParams.get('regularThreshold'),   80)
    const cfgParams: unknown[] = [windowDays, newRiderDays, eveningThreshold, crossThreshold, regularThreshold]

    // Shared classification CTE — always uses full 30d window for L30D profile
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

    // City/Hub filter
    const filterParams: unknown[] = []
    let where = 'WHERE 1=1'
    let paramIdx = 6
    if (city) { where += ` AND COALESCE(city, 'Unmapped') = $${paramIdx++}`; filterParams.push(city) }
    if (hub)  { where += ` AND hub = $${paramIdx++}`;                        filterParams.push(hub) }

    // City/hub option lists
    const cityList = await query<{ city: string }>(
      'SELECT DISTINCT city FROM hub_mapping WHERE city IS NOT NULL ORDER BY city'
    )
    const hubList = city
      ? await query<{ hub: string }>('SELECT DISTINCT hub FROM hub_mapping WHERE city = $1 ORDER BY hub', [city])
      : await query<{ hub: string }>('SELECT DISTINCT hub FROM hub_mapping ORDER BY hub')

    // ── Helper: build matrix for a date window ────────────────────────────────
    async function matrixForWindow(
      startOffset: number, // days before anchor (inclusive start = further back)
      endOffset: number,   // days before anchor (inclusive end = closer to anchor)
      isAvg: boolean,      // true = return avg daily riders; false = return single-day count
    ): Promise<{ matrix: Matrix; total: number }> {
      const bucketParams: unknown[] = [...cfgParams, startOffset, endOffset, ...filterParams]
      let bucketParamIdx = 6
      const startParam = `$${bucketParamIdx++}`
      const endParam   = `$${bucketParamIdx++}`

      // Count riders per calendar day in the window (one rider appearing on 3 days = 3 rows here).
      // Then average across the number of distinct dates in the bucket. This gives a true
      // avg-daily-riders figure, consistent with how the main table reports avg/day.
      const rows = await query<{ regularity_tag: string; login_behaviour_tag: string; n: number }>(
        `WITH ${classifyCte},
daily_riders AS (
  -- one row per (date, rider) within the bucket window
  SELECT rd.date, rs.rider_id, rs.regularity_tag, rs.login_behaviour_tag
  FROM rider_daily rd
  JOIN rider_summary rs ON rs.rider_id = rd.rider_id
  CROSS JOIN anchor
  WHERE rd.date BETWEEN (anchor.anchor_date - ${startParam}::INTEGER * INTERVAL '1 day')::DATE
                    AND (anchor.anchor_date - ${endParam}::INTEGER * INTERVAL '1 day')::DATE
  ${where.replace('WHERE 1=1', 'AND 1=1').replace(/\bcity\b/g, 'rs.city').replace(/\bhub\b/g, 'rs.hub').replace(/\blogin_behaviour_tag\b/g, 'rs.login_behaviour_tag').replace(/\bregularity_tag\b/g, 'rs.regularity_tag')}
),
bucket_date_count AS (
  SELECT COUNT(DISTINCT date)::NUMERIC AS num_dates FROM daily_riders
),
bucket_agg AS (
  SELECT regularity_tag, login_behaviour_tag,
    COUNT(*)::NUMERIC AS login_events
  FROM daily_riders
  GROUP BY regularity_tag, login_behaviour_tag
)
SELECT regularity_tag, login_behaviour_tag,
  CASE WHEN (SELECT num_dates FROM bucket_date_count) = 0 THEN 0
       ELSE ROUND(login_events / (SELECT num_dates FROM bucket_date_count))
  END AS n
FROM bucket_agg`,
        bucketParams,
      )

      const [totalRow] = await query<{ n: number }>(
        `WITH ${classifyCte},
daily_riders AS (
  SELECT rd.date, rs.rider_id
  FROM rider_daily rd
  JOIN rider_summary rs ON rs.rider_id = rd.rider_id
  CROSS JOIN anchor
  WHERE rd.date BETWEEN (anchor.anchor_date - ${startParam}::INTEGER * INTERVAL '1 day')::DATE
                    AND (anchor.anchor_date - ${endParam}::INTEGER * INTERVAL '1 day')::DATE
  ${where.replace('WHERE 1=1', 'AND 1=1').replace(/\bcity\b/g, 'rs.city').replace(/\bhub\b/g, 'rs.hub').replace(/\blogin_behaviour_tag\b/g, 'rs.login_behaviour_tag').replace(/\bregularity_tag\b/g, 'rs.regularity_tag')}
),
bucket_date_count AS (SELECT COUNT(DISTINCT date)::NUMERIC AS num_dates FROM daily_riders)
SELECT CASE WHEN (SELECT num_dates FROM bucket_date_count) = 0 THEN 0
            ELSE ROUND(COUNT(*)::NUMERIC / (SELECT num_dates FROM bucket_date_count))
       END AS n
FROM daily_riders`,
        bucketParams,
      )

      const matrix = buildMatrix(rows)
      const total = totalRow ? Number(totalRow.n) : 0
      return { matrix, total }
    }

    // Fetch all 4 buckets in parallel:
    // W-3: days 29..22 before anchor (oldest week, 8 days inclusive = days 22-29)
    // W-2: days 21..15 before anchor
    // W-1: days 14..8  before anchor
    // D-1: days 1..1   before anchor (anchor - 1 = last data date)
    const [w3, w2, w1, d1] = await Promise.all([
      matrixForWindow(29, 22, true),  // W-3: days 22-29 before anchor (8 days)
      matrixForWindow(21, 15, true),  // W-2: days 15-21 before anchor (7 days)
      matrixForWindow(14,  8, true),  // W-1: days 8-14 before anchor (7 days)
      matrixForWindow( 1,  1, false), // D-1: anchor minus 1 (single day)
    ])

    return NextResponse.json({
      weeks: { w3, w2, w1, d1 },
      cities: cityList.map(r => r.city),
      hubs: hubList.map(r => r.hub),
    })
  } catch (err) {
    console.error('[API /profiling/matrix]', err)
    const { status, body } = apiError(err)
    return NextResponse.json(body, { status })
  }
}
