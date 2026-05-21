export const runtime = 'nodejs'
export const revalidate = 300
import { NextResponse } from 'next/server'
import { query } from '@/backend/db'
import {
  apiError,
  parseBehaviour,
  parseRegularity,
  parseThreshold,
  parseWindowDays,
} from '@/lib/validators'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  try {
    const behaviour = parseBehaviour(searchParams.get('behaviour'))
    const regularity = parseRegularity(searchParams.get('regularity'))

    const behaviourClause = behaviour ? 'AND login_behaviour_tag = ?' : ''
    const regularityClause = regularity ? 'AND regularity_tag = ?' : ''
    const filterParams = [
      ...(behaviour ? [behaviour] : []),
      ...(regularity ? [regularity] : []),
    ]

    const includeRiders = searchParams.get('riders') === '1'

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
    rd.rider_id,
    rd.rider_name,
    rd.hub,
    rd.date,
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
    rider_id,
    MAX(rider_name)  AS rider_name,
    MAX(hub)         AS hub,
    (SELECT window_days FROM cfg) AS total_days,
    SUM(had_any_login)    AS login_days,
    SUM(had_morning_login) AS morning_login_days,
    SUM(had_evening_login) AS evening_login_days,
    ROUND(SUM(had_any_login) * 100.0 / (SELECT window_days FROM cfg), 1) AS login_rate_pct,
    ROUND(SUM(had_evening_login) * 100.0 / NULLIF(SUM(had_any_login), 0), 1) AS evening_login_rate_pct,
    MIN(date) AS first_login_in_window
  FROM rider_window
  GROUP BY rider_id
),
global_first AS (
  SELECT rider_id, MIN(date) AS first_ever_login
  FROM rider_daily
  GROUP BY rider_id
),
classified AS (
  SELECT
    a.*,
    gf.first_ever_login,
    (SELECT max_date FROM v_max_date) AS max_date,
    DATEDIFF('day', gf.first_ever_login, (SELECT max_date FROM v_max_date)) AS active_since_days,
    CASE
      WHEN DATEDIFF('day', gf.first_ever_login, (SELECT max_date FROM v_max_date)) <= (SELECT new_rider_days FROM cfg)
        THEN TRUE ELSE FALSE
    END AS is_new_rider,
    CASE
      WHEN morning_login_days = 0 AND evening_login_rate_pct >= (SELECT evening_threshold FROM cfg)
        THEN 'Evening Rider'
      WHEN morning_login_days > 0 AND evening_login_rate_pct >= (SELECT cross_threshold FROM cfg)
        THEN 'Cross Utilised'
      ELSE 'Morning Rider'
    END AS login_behaviour_tag,
    CASE
      WHEN DATEDIFF('day', gf.first_ever_login, (SELECT max_date FROM v_max_date)) <= (SELECT new_rider_days FROM cfg)
        THEN 'New Rider'
      WHEN login_rate_pct >= (SELECT regular_threshold FROM cfg)
        THEN 'Regular'
      ELSE 'Irregular'
    END AS regularity_tag
  FROM agg a
  JOIN global_first gf USING (rider_id)
),
rider_summary AS (
  SELECT c.*, hm.city, hm.zone, hm.pod_name
  FROM classified c
  LEFT JOIN hub_mapping hm ON LOWER(c.hub) = LOWER(hm.hub)
)`

    // avg_daily_src: per-day login counts from rider_daily (basis for avg daily rider numbers)
    // Classification tags from rider_summary (window-level) are joined for Regular/Irregular/New %
    const avgDailyCte = `
avg_daily_by_city AS (
  SELECT
    COALESCE(hm.city, 'Unmapped') AS city,
    rd.date,
    COUNT(DISTINCT rd.rider_id)::DOUBLE AS riders_that_day,
    COUNT(DISTINCT CASE WHEN rd.morning_runsheet_hour IS NOT NULL THEN rd.rider_id END)::DOUBLE AS morning_that_day,
    COUNT(DISTINCT CASE WHEN rd.evening_runsheet_hour IS NOT NULL THEN rd.rider_id END)::DOUBLE AS evening_that_day,
    COUNT(DISTINCT CASE WHEN rd.morning_runsheet_hour IS NOT NULL AND rd.evening_runsheet_hour IS NOT NULL THEN rd.rider_id END)::DOUBLE AS cross_that_day
  FROM rider_daily rd
  CROSS JOIN (SELECT max_date FROM v_max_date) mx
  LEFT JOIN hub_mapping hm ON LOWER(rd.hub) = LOWER(hm.hub)
  WHERE rd.date BETWEEN (mx.max_date - INTERVAL (?::INTEGER - 1) DAY) AND mx.max_date
  GROUP BY hm.city, rd.date
),
avg_daily_by_hub AS (
  SELECT
    rd.hub,
    COALESCE(hm.city, 'Unmapped') AS city,
    rd.date,
    COUNT(DISTINCT rd.rider_id)::DOUBLE AS riders_that_day,
    COUNT(DISTINCT CASE WHEN rd.morning_runsheet_hour IS NOT NULL THEN rd.rider_id END)::DOUBLE AS morning_that_day,
    COUNT(DISTINCT CASE WHEN rd.evening_runsheet_hour IS NOT NULL THEN rd.rider_id END)::DOUBLE AS evening_that_day,
    COUNT(DISTINCT CASE WHEN rd.morning_runsheet_hour IS NOT NULL AND rd.evening_runsheet_hour IS NOT NULL THEN rd.rider_id END)::DOUBLE AS cross_that_day
  FROM rider_daily rd
  CROSS JOIN (SELECT max_date FROM v_max_date) mx
  LEFT JOIN hub_mapping hm ON LOWER(rd.hub) = LOWER(hm.hub)
  WHERE rd.date BETWEEN (mx.max_date - INTERVAL (?::INTEGER - 1) DAY) AND mx.max_date
  GROUP BY rd.hub, hm.city, rd.date
)`

    const cityRows = await query<Record<string, unknown>>(
      `WITH ${classifyCte},
      ${avgDailyCte}
      SELECT
        adc.city,
        ROUND(AVG(adc.riders_that_day), 1)  AS avg_daily_riders,
        ROUND(AVG(adc.morning_that_day), 1) AS avg_morning,
        ROUND(AVG(adc.evening_that_day), 1) AS avg_evening,
        ROUND(AVG(adc.cross_that_day), 1)   AS avg_cross,
        COUNT(DISTINCT rs.rider_id) FILTER (WHERE rs.regularity_tag = 'Regular')   AS regular_count,
        COUNT(DISTINCT rs.rider_id) FILTER (WHERE rs.regularity_tag = 'Irregular') AS irregular_count,
        COUNT(DISTINCT rs.rider_id) FILTER (WHERE rs.regularity_tag = 'New Rider') AS new_rider_count,
        COUNT(DISTINCT rs.rider_id) AS total_unique_riders
      FROM avg_daily_by_city adc
      LEFT JOIN rider_summary rs ON COALESCE(rs.city, 'Unmapped') = adc.city
        ${behaviourClause.replace('AND login_behaviour_tag', 'AND rs.login_behaviour_tag')}
        ${regularityClause.replace('AND regularity_tag', 'AND rs.regularity_tag')}
      GROUP BY adc.city
      ORDER BY avg_daily_riders DESC`,
      [...cfgParams, windowDays, windowDays, ...filterParams],
    )

    const hubRows = await query<Record<string, unknown>>(
      `WITH ${classifyCte},
      ${avgDailyCte}
      SELECT
        adh.hub,
        adh.city,
        ROUND(AVG(adh.riders_that_day), 1)  AS avg_daily_riders,
        ROUND(AVG(adh.morning_that_day), 1) AS avg_morning,
        ROUND(AVG(adh.evening_that_day), 1) AS avg_evening,
        ROUND(AVG(adh.cross_that_day), 1)   AS avg_cross,
        COUNT(DISTINCT rs.rider_id) FILTER (WHERE rs.regularity_tag = 'Regular')   AS regular_count,
        COUNT(DISTINCT rs.rider_id) FILTER (WHERE rs.regularity_tag = 'Irregular') AS irregular_count,
        COUNT(DISTINCT rs.rider_id) FILTER (WHERE rs.regularity_tag = 'New Rider') AS new_rider_count,
        COUNT(DISTINCT rs.rider_id) AS total_unique_riders
      FROM avg_daily_by_hub adh
      LEFT JOIN rider_summary rs ON LOWER(rs.hub) = LOWER(adh.hub)
        ${behaviourClause.replace('AND login_behaviour_tag', 'AND rs.login_behaviour_tag')}
        ${regularityClause.replace('AND regularity_tag', 'AND rs.regularity_tag')}
      GROUP BY adh.hub, adh.city
      ORDER BY adh.city, avg_daily_riders DESC`,
      [...cfgParams, windowDays, windowDays, ...filterParams],
    )

    const riderRows = includeRiders ? await query<Record<string, unknown>>(
      `WITH ${classifyCte}
      SELECT
        rider_id,
        rider_name,
        hub,
        COALESCE(city, 'Unmapped')       AS city,
        COALESCE(zone, '—')              AS zone,
        login_behaviour_tag,
        regularity_tag,
        ROUND(login_rate_pct, 1)         AS login_rate_pct,
        morning_login_days               AS morning_logins,
        evening_login_days               AS evening_logins,
        first_ever_login::VARCHAR        AS first_login_date,
        active_since_days
      FROM rider_summary
      WHERE 1=1 ${behaviourClause} ${regularityClause}
      ORDER BY city NULLS LAST, hub, rider_id`,
      [...cfgParams, ...filterParams],
    ) : []

    // Global KPI — always unfiltered (full picture across the dataset)
    const [kpi] = await query<Record<string, unknown>>(
      `WITH ${classifyCte}
      SELECT
        COUNT(*)                                                               AS total_riders,
        COUNT(*) FILTER (WHERE login_behaviour_tag = 'Evening Rider')          AS evening_count,
        COUNT(*) FILTER (WHERE login_behaviour_tag = 'Cross Utilised')         AS cross_util_count,
        COUNT(*) FILTER (WHERE login_behaviour_tag = 'Morning Rider')          AS morning_count,
        COUNT(*) FILTER (WHERE regularity_tag = 'Regular')                     AS regular_count,
        COUNT(*) FILTER (WHERE regularity_tag = 'Irregular')                   AS irregular_count,
        COUNT(*) FILTER (WHERE regularity_tag = 'New Rider')                   AS new_rider_count
      FROM rider_summary`,
      cfgParams,
    )

    const matrixRows = await query<{ regularity_tag: string; login_behaviour_tag: string; n: number }>(
      `WITH ${classifyCte}
      SELECT regularity_tag, login_behaviour_tag, COUNT(*) AS n
      FROM rider_summary
      GROUP BY regularity_tag, login_behaviour_tag
      ORDER BY regularity_tag, login_behaviour_tag`,
      cfgParams,
    )

    type MatrixCell = { evening: number; cross: number; morning: number; total: number }
    const matrix: Record<string, MatrixCell> = {
      Regular:   { evening: 0, cross: 0, morning: 0, total: 0 },
      Irregular: { evening: 0, cross: 0, morning: 0, total: 0 },
      'New Rider': { evening: 0, cross: 0, morning: 0, total: 0 },
    }
    for (const r of matrixRows) {
      const reg = r.regularity_tag
      const beh = r.login_behaviour_tag
      const n = Number(r.n)
      if (!matrix[reg]) matrix[reg] = { evening: 0, cross: 0, morning: 0, total: 0 }
      if (beh === 'Evening Rider') matrix[reg].evening = n
      else if (beh === 'Cross Utilised') matrix[reg].cross = n
      else if (beh === 'Morning Rider') matrix[reg].morning = n
      matrix[reg].total += n
    }

    return NextResponse.json({
      kpi: {
        totalRiders: Number(kpi.total_riders),
        eveningCount: Number(kpi.evening_count),
        crossUtilCount: Number(kpi.cross_util_count),
        morningCount: Number(kpi.morning_count),
        regularCount: Number(kpi.regular_count),
        irregularCount: Number(kpi.irregular_count),
        newRiderCount: Number(kpi.new_rider_count),
      },
      matrix,
      cities: cityRows.map(r => {
        const avg = Math.round(Number(r.avg_daily_riders))
        const eve = Math.round(Number(r.avg_evening))
        const crs = Math.round(Number(r.avg_cross))
        const mor = Math.round(Number(r.avg_morning))
        const uniq = Number(r.total_unique_riders)
        return {
          city: r.city, zone: '—',
          totalRiders: avg, eveningCount: eve, crossUtilCount: crs, morningCount: mor,
          regularCount: Number(r.regular_count), irregularCount: Number(r.irregular_count), newRiderCount: Number(r.new_rider_count),
          totalUniqueRiders: uniq,
          eveningRiderPct: avg > 0 ? Math.round(eve / avg * 1000) / 10 : 0,
          crossUtilisedPct: avg > 0 ? Math.round(crs / avg * 1000) / 10 : 0,
          morningRiderPct:  avg > 0 ? Math.round(mor / avg * 1000) / 10 : 0,
          regularPct:  uniq > 0 ? Math.round(Number(r.regular_count)  / uniq * 1000) / 10 : 0,
          irregularPct: uniq > 0 ? Math.round(Number(r.irregular_count) / uniq * 1000) / 10 : 0,
          newRiderPct: uniq > 0 ? Math.round(Number(r.new_rider_count)  / uniq * 1000) / 10 : 0,
        }
      }),
      hubs: hubRows.map(r => {
        const avg = Math.round(Number(r.avg_daily_riders))
        const eve = Math.round(Number(r.avg_evening))
        const crs = Math.round(Number(r.avg_cross))
        const mor = Math.round(Number(r.avg_morning))
        const uniq = Number(r.total_unique_riders)
        return {
          hub: r.hub, city: r.city,
          totalRiders: avg, eveningCount: eve, crossUtilCount: crs, morningCount: mor,
          regularCount: Number(r.regular_count), irregularCount: Number(r.irregular_count), newRiderCount: Number(r.new_rider_count),
          totalUniqueRiders: uniq,
          eveningRiderPct: avg > 0 ? Math.round(eve / avg * 1000) / 10 : 0,
          crossUtilisedPct: avg > 0 ? Math.round(crs / avg * 1000) / 10 : 0,
          morningRiderPct:  avg > 0 ? Math.round(mor / avg * 1000) / 10 : 0,
          regularPct:  uniq > 0 ? Math.round(Number(r.regular_count)  / uniq * 1000) / 10 : 0,
          irregularPct: uniq > 0 ? Math.round(Number(r.irregular_count) / uniq * 1000) / 10 : 0,
          newRiderPct: uniq > 0 ? Math.round(Number(r.new_rider_count)  / uniq * 1000) / 10 : 0,
        }
      }),
      riders: riderRows.map(r => ({
        riderId: String(r.rider_id),
        riderName: r.rider_name,
        hub: r.hub,
        city: r.city,
        loginBehaviourTag: r.login_behaviour_tag,
        regularityTag: r.regularity_tag,
        loginRatePct: Number(r.login_rate_pct),
        morningLogins: Number(r.morning_logins),
        eveningLogins: Number(r.evening_logins),
        firstLoginDate: (r.first_login_date as string | null)?.slice(0, 10) ?? '',
        activeSinceDays: Number(r.active_since_days),
      })),
    })
  } catch (err) {
    console.error('[API /profiling]', err)
    const { status, body } = apiError(err)
    return NextResponse.json(body, { status })
  }
}
