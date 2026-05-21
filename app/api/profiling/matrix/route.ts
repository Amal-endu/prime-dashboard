export const runtime = 'nodejs'
export const revalidate = 300
import { NextResponse } from 'next/server'
import { query } from '@/backend/db'
import { apiError, parseParamString, parseThreshold, parseWindowDays } from '@/lib/validators'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  try {
    const city = parseParamString(searchParams.get('city'), 'city')
    const hub = parseParamString(searchParams.get('hub'), 'hub')

    const windowDays       = parseWindowDays(searchParams.get('windowDays'),       30)
    const newRiderDays     = parseWindowDays(searchParams.get('newRiderDays'),       7)
    const eveningThreshold = parseThreshold(searchParams.get('eveningThreshold'),   80)
    const crossThreshold   = parseThreshold(searchParams.get('crossThreshold'),     70)
    const regularThreshold = parseThreshold(searchParams.get('regularThreshold'),   80)
    const cfgParams = [windowDays, newRiderDays, eveningThreshold, crossThreshold, regularThreshold]

    const classifyCte = `
cfg AS (
  SELECT
    ?::INTEGER AS window_days,
    ?::INTEGER AS new_rider_days,
    ?::DOUBLE  AS evening_threshold,
    ?::DOUBLE  AS cross_threshold,
    ?::DOUBLE  AS regular_threshold
),
rider_window AS (
  SELECT
    rd.rider_id, rd.rider_name, rd.hub, rd.date,
    CASE WHEN rd.morning_runsheet_hour IS NOT NULL THEN 1 ELSE 0 END AS had_morning_login,
    CASE WHEN rd.evening_runsheet_hour IS NOT NULL THEN 1 ELSE 0 END AS had_evening_login,
    1 AS had_any_login
  FROM rider_daily rd
  CROSS JOIN (SELECT max_date FROM v_max_date) mx
  CROSS JOIN cfg
  WHERE rd.date BETWEEN (mx.max_date - INTERVAL (cfg.window_days - 1) DAY) AND mx.max_date
),
agg AS (
  SELECT
    rider_id, MAX(rider_name) AS rider_name, MAX(hub) AS hub,
    (SELECT window_days FROM cfg) AS total_days,
    SUM(had_any_login) AS login_days,
    SUM(had_morning_login) AS morning_login_days,
    SUM(had_evening_login) AS evening_login_days,
    ROUND(SUM(had_any_login) * 100.0 / (SELECT window_days FROM cfg), 1) AS login_rate_pct,
    ROUND(SUM(had_evening_login) * 100.0 / NULLIF(SUM(had_any_login), 0), 1) AS evening_login_rate_pct,
    MIN(date) AS first_login_in_window
  FROM rider_window GROUP BY rider_id
),
global_first AS (
  SELECT rider_id, MIN(date) AS first_ever_login FROM rider_daily GROUP BY rider_id
),
classified AS (
  SELECT a.*, gf.first_ever_login,
    (SELECT max_date FROM v_max_date) AS max_date,
    DATEDIFF('day', gf.first_ever_login, (SELECT max_date FROM v_max_date)) AS active_since_days,
    CASE WHEN DATEDIFF('day', gf.first_ever_login, (SELECT max_date FROM v_max_date)) <= (SELECT new_rider_days FROM cfg) THEN TRUE ELSE FALSE END AS is_new_rider,
    CASE
      WHEN morning_login_days = 0 AND evening_login_rate_pct >= (SELECT evening_threshold FROM cfg) THEN 'Evening Rider'
      WHEN morning_login_days > 0 AND evening_login_rate_pct >= (SELECT cross_threshold FROM cfg) THEN 'Cross Utilised'
      ELSE 'Morning Rider'
    END AS login_behaviour_tag,
    CASE
      WHEN DATEDIFF('day', gf.first_ever_login, (SELECT max_date FROM v_max_date)) <= (SELECT new_rider_days FROM cfg) THEN 'New Rider'
      WHEN login_rate_pct >= (SELECT regular_threshold FROM cfg) THEN 'Regular'
      ELSE 'Irregular'
    END AS regularity_tag
  FROM agg a JOIN global_first gf USING (rider_id)
),
rider_summary AS (
  SELECT c.*, hm.city, hm.zone, hm.pod_name
  FROM classified c LEFT JOIN hub_mapping hm ON LOWER(c.hub) = LOWER(hm.hub)
)`

    const cityList = await query<{ city: string }>(`
      SELECT DISTINCT COALESCE(city, 'Unmapped') AS city
      FROM v_rider_summary
      ORDER BY city
    `)

    const hubList = city
      ? await query<{ hub: string }>(
          `SELECT DISTINCT hub
             FROM v_rider_summary
            WHERE COALESCE(city, 'Unmapped') = ?
            ORDER BY hub`,
          [city],
        )
      : await query<{ hub: string }>('SELECT DISTINCT hub FROM v_rider_summary ORDER BY hub')

    const filterParams: string[] = []
    let where = 'WHERE 1=1'
    if (city) { where += " AND COALESCE(city, 'Unmapped') = ?"; filterParams.push(city) }
    if (hub)  { where += ' AND hub = ?';                         filterParams.push(hub) }

    const matrixRows = await query<{ regularity_tag: string; login_behaviour_tag: string; n: number }>(
      `WITH ${classifyCte}
  SELECT regularity_tag, login_behaviour_tag, COUNT(*) AS n
  FROM rider_summary
  ${where}
  GROUP BY regularity_tag, login_behaviour_tag
  ORDER BY regularity_tag, login_behaviour_tag`,
      [...cfgParams, ...filterParams],
    )

    const [{ n: scopeTotal }] = await query<{ n: number }>(
      `WITH ${classifyCte}
  SELECT COUNT(*) AS n FROM rider_summary ${where}`,
      [...cfgParams, ...filterParams],
    )

    type MatrixCell = { evening: number; cross: number; morning: number; total: number }
    const matrix: Record<string, MatrixCell> = {
      Regular:     { evening: 0, cross: 0, morning: 0, total: 0 },
      Irregular:   { evening: 0, cross: 0, morning: 0, total: 0 },
      'New Rider': { evening: 0, cross: 0, morning: 0, total: 0 },
    }
    for (const r of matrixRows) {
      const reg = r.regularity_tag
      const beh = r.login_behaviour_tag
      const n = Number(r.n)
      if (!matrix[reg]) matrix[reg] = { evening: 0, cross: 0, morning: 0, total: 0 }
      if (beh === 'Evening Rider')        matrix[reg].evening = n
      else if (beh === 'Cross Utilised')  matrix[reg].cross = n
      else if (beh === 'Morning Rider')   matrix[reg].morning = n
      matrix[reg].total += n
    }

    return NextResponse.json({
      matrix,
      total: Number(scopeTotal),
      cities: cityList.map(r => r.city),
      hubs: hubList.map(r => r.hub),
    })
  } catch (err) {
    console.error('[API /profiling/matrix]', err)
    const { status, body } = apiError(err)
    return NextResponse.json(body, { status })
  }
}
