export const runtime = 'nodejs'
export const revalidate = 300
import { NextResponse } from 'next/server'
import { query } from '@/lib/supabase/sql'
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

    const includeRiders = searchParams.get('riders') === '1'

    const windowDays       = parseWindowDays(searchParams.get('windowDays'),       30)
    const newRiderDays     = parseWindowDays(searchParams.get('newRiderDays'),       7)
    const eveningThreshold = parseThreshold(searchParams.get('eveningThreshold'),   80)
    const crossThreshold   = parseThreshold(searchParams.get('crossThreshold'),     70)
    const regularThreshold = parseThreshold(searchParams.get('regularThreshold'),   80)
    const cfgParams: unknown[] = [windowDays, newRiderDays, eveningThreshold, crossThreshold, regularThreshold]

    const behaviourParam = behaviour ? behaviour : null
    const regularityParam = regularity ? regularity : null

    // $6 = behaviour filter (null = no filter), $7 = regularity filter (null = no filter)
    const filterClause = `
      AND ($6::TEXT IS NULL OR login_behaviour_tag = $6)
      AND ($7::TEXT IS NULL OR regularity_tag = $7)
    `
    const filterParams: unknown[] = [behaviourParam, regularityParam]

    const classifyCte = `
cfg AS (
  SELECT
    $1::INTEGER AS window_days,
    $2::INTEGER AS new_rider_days,
    $3::NUMERIC   AS evening_threshold,
    $4::NUMERIC   AS cross_threshold,
    $5::NUMERIC   AS regular_threshold
),
anchor AS (SELECT anchor_date FROM data_anchor WHERE id = 1),
rider_window AS (
  SELECT
    rd.rider_id,
    rd.rider_name,
    rd.hub,
    rd.date,
    CASE WHEN rd.morning_runsheet_hour IS NOT NULL THEN 1 ELSE 0 END AS had_morning_login,
    CASE WHEN rd.evening_runsheet_hour IS NOT NULL THEN 1 ELSE 0 END AS had_evening_login,
    1 AS had_any_login
  FROM rider_daily rd, anchor, cfg
  WHERE rd.date BETWEEN (anchor.anchor_date - (cfg.window_days - 1) * INTERVAL '1 day')::DATE
                    AND anchor.anchor_date
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
    ROUND(SUM(had_evening_login) * 100.0 / NULLIF(SUM(had_any_login), 0), 1) AS evening_login_rate_pct
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
    (SELECT anchor_date FROM anchor) AS max_date,
    ((SELECT anchor_date FROM anchor) - gf.first_ever_login) AS active_since_days,
    CASE
      WHEN morning_login_days = 0 AND evening_login_rate_pct >= (SELECT evening_threshold FROM cfg)
        THEN 'Evening Rider'
      WHEN morning_login_days > 0 AND evening_login_rate_pct >= (SELECT cross_threshold FROM cfg)
        THEN 'Cross Utilised'
      ELSE 'Morning Rider'
    END AS login_behaviour_tag,
    CASE
      WHEN ((SELECT anchor_date FROM anchor) - gf.first_ever_login) <= (SELECT new_rider_days FROM cfg)
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

    const avgDailyCte = `
raw_metrics AS (
  SELECT
    rd.rider_id,
    rd.hub,
    COALESCE(hm.city, 'Unmapped') AS city,
    rd.date,
    rd.morning_runsheet_hour,
    rd.evening_runsheet_hour,
    rd.attempt_morning,
    rd.attempt_evening
  FROM rider_daily rd
  CROSS JOIN anchor
  LEFT JOIN hub_mapping hm ON LOWER(rd.hub) = LOWER(hm.hub)
  WHERE rd.date BETWEEN (anchor.anchor_date - ((SELECT window_days FROM cfg) - 1) * INTERVAL '1 day')::DATE
                    AND anchor.anchor_date
),
city_metrics AS (
  SELECT
    city,
    ROUND(AVG(daily_riders), 1)     AS avg_daily_riders,
    ROUND(AVG(morning_that_day), 1) AS avg_morning,
    ROUND(AVG(evening_that_day), 1) AS avg_evening,
    ROUND(AVG(cross_that_day), 1)   AS avg_cross,
    ROUND(SUM(sum_morning_hr)::NUMERIC  / NULLIF(SUM(morning_login_days), 0), 2) AS avg_morning_login_hr,
    ROUND(SUM(sum_morning_atp)::NUMERIC / NULLIF(SUM(morning_login_days), 0), 1) AS avg_morning_atp,
    ROUND(SUM(sum_evening_hr)::NUMERIC  / NULLIF(SUM(evening_login_days), 0), 2) AS avg_evening_login_hr,
    ROUND(SUM(sum_evening_atp)::NUMERIC / NULLIF(SUM(evening_login_days), 0), 1) AS avg_evening_atp
  FROM (
    SELECT city, date,
      COUNT(DISTINCT rider_id)::NUMERIC AS daily_riders,
      COUNT(DISTINCT CASE WHEN morning_runsheet_hour IS NOT NULL THEN rider_id END)::NUMERIC AS morning_that_day,
      COUNT(DISTINCT CASE WHEN evening_runsheet_hour IS NOT NULL THEN rider_id END)::NUMERIC AS evening_that_day,
      COUNT(DISTINCT CASE WHEN morning_runsheet_hour IS NOT NULL AND evening_runsheet_hour IS NOT NULL THEN rider_id END)::NUMERIC AS cross_that_day,
      SUM(CASE WHEN morning_runsheet_hour IS NOT NULL THEN morning_runsheet_hour ELSE 0 END) AS sum_morning_hr,
      SUM(CASE WHEN morning_runsheet_hour IS NOT NULL THEN 1 ELSE 0 END)                    AS morning_login_days,
      SUM(attempt_morning)                                                                  AS sum_morning_atp,
      SUM(CASE WHEN evening_runsheet_hour IS NOT NULL THEN evening_runsheet_hour ELSE 0 END) AS sum_evening_hr,
      SUM(CASE WHEN evening_runsheet_hour IS NOT NULL THEN 1 ELSE 0 END)                    AS evening_login_days,
      SUM(attempt_evening)                                                                  AS sum_evening_atp
    FROM raw_metrics GROUP BY city, date
  ) sub GROUP BY city
),
hub_metrics AS (
  SELECT
    hub, city,
    ROUND(AVG(daily_riders), 1)     AS avg_daily_riders,
    ROUND(AVG(morning_that_day), 1) AS avg_morning,
    ROUND(AVG(evening_that_day), 1) AS avg_evening,
    ROUND(AVG(cross_that_day), 1)   AS avg_cross,
    ROUND(SUM(sum_morning_hr)::NUMERIC  / NULLIF(SUM(morning_login_days), 0), 2) AS avg_morning_login_hr,
    ROUND(SUM(sum_morning_atp)::NUMERIC / NULLIF(SUM(morning_login_days), 0), 1) AS avg_morning_atp,
    ROUND(SUM(sum_evening_hr)::NUMERIC  / NULLIF(SUM(evening_login_days), 0), 2) AS avg_evening_login_hr,
    ROUND(SUM(sum_evening_atp)::NUMERIC / NULLIF(SUM(evening_login_days), 0), 1) AS avg_evening_atp
  FROM (
    SELECT hub, city, date,
      COUNT(DISTINCT rider_id)::NUMERIC AS daily_riders,
      COUNT(DISTINCT CASE WHEN morning_runsheet_hour IS NOT NULL THEN rider_id END)::NUMERIC AS morning_that_day,
      COUNT(DISTINCT CASE WHEN evening_runsheet_hour IS NOT NULL THEN rider_id END)::NUMERIC AS evening_that_day,
      COUNT(DISTINCT CASE WHEN morning_runsheet_hour IS NOT NULL AND evening_runsheet_hour IS NOT NULL THEN rider_id END)::NUMERIC AS cross_that_day,
      SUM(CASE WHEN morning_runsheet_hour IS NOT NULL THEN morning_runsheet_hour ELSE 0 END) AS sum_morning_hr,
      SUM(CASE WHEN morning_runsheet_hour IS NOT NULL THEN 1 ELSE 0 END)                    AS morning_login_days,
      SUM(attempt_morning)                                                                  AS sum_morning_atp,
      SUM(CASE WHEN evening_runsheet_hour IS NOT NULL THEN evening_runsheet_hour ELSE 0 END) AS sum_evening_hr,
      SUM(CASE WHEN evening_runsheet_hour IS NOT NULL THEN 1 ELSE 0 END)                    AS evening_login_days,
      SUM(attempt_evening)                                                                  AS sum_evening_atp
    FROM raw_metrics GROUP BY hub, city, date
  ) sub GROUP BY hub, city
)`

    const cityRows = await query<Record<string, unknown>>(
      `WITH ${classifyCte},
      ${avgDailyCte}
      SELECT
        cm.city,
        cm.avg_daily_riders, cm.avg_morning, cm.avg_evening, cm.avg_cross,
        cm.avg_morning_login_hr, cm.avg_morning_atp,
        cm.avg_evening_login_hr, cm.avg_evening_atp,
        COUNT(DISTINCT rs.rider_id) AS total_unique_riders
      FROM city_metrics cm
      LEFT JOIN rider_summary rs ON COALESCE(rs.city, 'Unmapped') = cm.city
        ${filterClause.replace(/login_behaviour_tag/g, 'rs.login_behaviour_tag').replace(/regularity_tag/g, 'rs.regularity_tag')}
      GROUP BY cm.city, cm.avg_daily_riders, cm.avg_morning, cm.avg_evening, cm.avg_cross,
               cm.avg_morning_login_hr, cm.avg_morning_atp, cm.avg_evening_login_hr, cm.avg_evening_atp
      ORDER BY cm.avg_daily_riders DESC`,
      [...cfgParams, ...filterParams],
    )

    const hubRows = await query<Record<string, unknown>>(
      `WITH ${classifyCte},
      ${avgDailyCte}
      SELECT
        hm2.hub, hm2.city,
        hm2.avg_daily_riders, hm2.avg_morning, hm2.avg_evening, hm2.avg_cross,
        hm2.avg_morning_login_hr, hm2.avg_morning_atp,
        hm2.avg_evening_login_hr, hm2.avg_evening_atp,
        COUNT(DISTINCT rs.rider_id) AS total_unique_riders
      FROM hub_metrics hm2
      LEFT JOIN rider_summary rs ON LOWER(rs.hub) = LOWER(hm2.hub)
        ${filterClause.replace(/login_behaviour_tag/g, 'rs.login_behaviour_tag').replace(/regularity_tag/g, 'rs.regularity_tag')}
      GROUP BY hm2.hub, hm2.city, hm2.avg_daily_riders, hm2.avg_morning, hm2.avg_evening, hm2.avg_cross,
               hm2.avg_morning_login_hr, hm2.avg_morning_atp, hm2.avg_evening_login_hr, hm2.avg_evening_atp
      ORDER BY hm2.city, hm2.avg_daily_riders DESC`,
      [...cfgParams, ...filterParams],
    )

    const riderRows = includeRiders ? await query<Record<string, unknown>>(
      `WITH ${classifyCte},
      rider_atp AS (
        SELECT
          rd.rider_id,
          ROUND(
            SUM(rd.attempt_morning)::NUMERIC / NULLIF(SUM(CASE WHEN rd.morning_runsheet_hour IS NOT NULL THEN 1 END), 0)
          , 1) AS avg_morning_atp,
          ROUND(
            AVG(CASE WHEN rd.morning_runsheet_hour IS NOT NULL THEN rd.morning_runsheet_hour END)
          , 2) AS avg_morning_login_hr,
          ROUND(
            SUM(rd.attempt_evening)::NUMERIC / NULLIF(SUM(CASE WHEN rd.evening_runsheet_hour IS NOT NULL THEN 1 END), 0)
          , 1) AS avg_evening_atp,
          ROUND(
            AVG(CASE WHEN rd.evening_runsheet_hour IS NOT NULL THEN rd.evening_runsheet_hour END)
          , 2) AS avg_evening_login_hr
        FROM rider_daily rd, anchor
        WHERE rd.date BETWEEN (anchor.anchor_date - ((SELECT window_days FROM cfg) - 1) * INTERVAL '1 day')::DATE
                          AND anchor.anchor_date
        GROUP BY rd.rider_id
      )
      SELECT
        rs.rider_id, rs.rider_name, rs.hub,
        COALESCE(rs.city, 'Unmapped') AS city,
        COALESCE(rs.zone, '—')        AS zone,
        rs.login_behaviour_tag, rs.regularity_tag,
        ROUND(rs.login_rate_pct, 1)   AS login_rate_pct,
        rs.morning_login_days         AS morning_logins,
        rs.evening_login_days         AS evening_logins,
        rs.first_ever_login::TEXT     AS first_login_date,
        rs.active_since_days,
        ra.avg_morning_atp, ra.avg_morning_login_hr,
        ra.avg_evening_atp, ra.avg_evening_login_hr
      FROM rider_summary rs
      LEFT JOIN rider_atp ra ON rs.rider_id = ra.rider_id
      WHERE ($6::TEXT IS NULL OR rs.login_behaviour_tag = $6)
        AND ($7::TEXT IS NULL OR rs.regularity_tag = $7)
      ORDER BY city NULLS LAST, hub, rs.rider_id`,
      [...cfgParams, ...filterParams],
    ) : []

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
          totalUniqueRiders: uniq,
          eveningRiderPct: avg > 0 ? Math.round(eve / avg * 1000) / 10 : 0,
          crossUtilisedPct: avg > 0 ? Math.round(crs / avg * 1000) / 10 : 0,
          morningRiderPct:  avg > 0 ? Math.round(mor / avg * 1000) / 10 : 0,
          avgMorningLoginHr: r.avg_morning_login_hr != null ? Number(r.avg_morning_login_hr) : null,
          avgMorningAtp:     r.avg_morning_atp     != null ? Number(r.avg_morning_atp)     : null,
          avgEveningLoginHr: r.avg_evening_login_hr != null ? Number(r.avg_evening_login_hr) : null,
          avgEveningAtp:     r.avg_evening_atp     != null ? Number(r.avg_evening_atp)     : null,
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
          totalUniqueRiders: uniq,
          eveningRiderPct: avg > 0 ? Math.round(eve / avg * 1000) / 10 : 0,
          crossUtilisedPct: avg > 0 ? Math.round(crs / avg * 1000) / 10 : 0,
          morningRiderPct:  avg > 0 ? Math.round(mor / avg * 1000) / 10 : 0,
          avgMorningLoginHr: r.avg_morning_login_hr != null ? Number(r.avg_morning_login_hr) : null,
          avgMorningAtp:     r.avg_morning_atp     != null ? Number(r.avg_morning_atp)     : null,
          avgEveningLoginHr: r.avg_evening_login_hr != null ? Number(r.avg_evening_login_hr) : null,
          avgEveningAtp:     r.avg_evening_atp     != null ? Number(r.avg_evening_atp)     : null,
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
        avgMorningLoginHr: r.avg_morning_login_hr != null ? Number(r.avg_morning_login_hr) : null,
        avgMorningAtp:     r.avg_morning_atp     != null ? Number(r.avg_morning_atp)     : null,
        avgEveningLoginHr: r.avg_evening_login_hr != null ? Number(r.avg_evening_login_hr) : null,
        avgEveningAtp:     r.avg_evening_atp     != null ? Number(r.avg_evening_atp)     : null,
      })),
    })
  } catch (err) {
    console.error('[API /profiling]', err)
    const { status, body } = apiError(err)
    return NextResponse.json(body, { status })
  }
}
