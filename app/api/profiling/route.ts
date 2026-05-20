export const runtime = 'nodejs'
import { NextResponse } from 'next/server'
import { query } from '@/backend/db'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const behaviour = searchParams.get('behaviour')
  const regularity = searchParams.get('regularity')

  const behaviourClause = behaviour ? `AND login_behaviour_tag = '${behaviour.replace(/'/g, "''")}'` : ''
  const regularityClause = regularity ? `AND regularity_tag = '${regularity.replace(/'/g, "''")}'` : ''
  const filterClause = `${behaviourClause} ${regularityClause}`

  try {
    // City-level aggregations — honours filters
    const cityRows = await query(`
      SELECT
        COALESCE(city, 'Unmapped')                                            AS city,
        COALESCE(zone, '—')                                                   AS zone,
        COUNT(*)                                                              AS total_riders,
        COUNT(*) FILTER (WHERE login_behaviour_tag = 'Evening Rider')         AS evening_count,
        COUNT(*) FILTER (WHERE login_behaviour_tag = 'Cross Utilised')        AS cross_util_count,
        COUNT(*) FILTER (WHERE login_behaviour_tag = 'Morning Rider')         AS morning_count,
        COUNT(*) FILTER (WHERE regularity_tag = 'Regular')                    AS regular_count,
        COUNT(*) FILTER (WHERE regularity_tag = 'Irregular')                  AS irregular_count,
        COUNT(*) FILTER (WHERE regularity_tag = 'New Rider')                  AS new_rider_count,
        ROUND(COUNT(*) FILTER (WHERE login_behaviour_tag = 'Evening Rider')  * 100.0 / COUNT(*), 1) AS evening_pct,
        ROUND(COUNT(*) FILTER (WHERE login_behaviour_tag = 'Cross Utilised') * 100.0 / COUNT(*), 1) AS cross_util_pct,
        ROUND(COUNT(*) FILTER (WHERE login_behaviour_tag = 'Morning Rider')  * 100.0 / COUNT(*), 1) AS morning_pct,
        ROUND(COUNT(*) FILTER (WHERE regularity_tag = 'Regular')             * 100.0 / COUNT(*), 1) AS regular_pct,
        ROUND(COUNT(*) FILTER (WHERE regularity_tag = 'Irregular')           * 100.0 / COUNT(*), 1) AS irregular_pct,
        ROUND(COUNT(*) FILTER (WHERE regularity_tag = 'New Rider')           * 100.0 / COUNT(*), 1) AS new_rider_pct
      FROM v_rider_summary
      WHERE 1=1 ${filterClause}
      GROUP BY COALESCE(city, 'Unmapped'), COALESCE(zone, '—')
      ORDER BY total_riders DESC
    `)

    // Hub-level aggregations — honours filters
    const hubRows = await query(`
      SELECT
        hub,
        COALESCE(city, 'Unmapped')                                            AS city,
        COUNT(*)                                                              AS total_riders,
        COUNT(*) FILTER (WHERE login_behaviour_tag = 'Evening Rider')         AS evening_count,
        COUNT(*) FILTER (WHERE login_behaviour_tag = 'Cross Utilised')        AS cross_util_count,
        COUNT(*) FILTER (WHERE login_behaviour_tag = 'Morning Rider')         AS morning_count,
        COUNT(*) FILTER (WHERE regularity_tag = 'Regular')                    AS regular_count,
        COUNT(*) FILTER (WHERE regularity_tag = 'Irregular')                  AS irregular_count,
        COUNT(*) FILTER (WHERE regularity_tag = 'New Rider')                  AS new_rider_count,
        ROUND(COUNT(*) FILTER (WHERE login_behaviour_tag = 'Evening Rider')  * 100.0 / COUNT(*), 1) AS evening_pct,
        ROUND(COUNT(*) FILTER (WHERE login_behaviour_tag = 'Cross Utilised') * 100.0 / COUNT(*), 1) AS cross_util_pct,
        ROUND(COUNT(*) FILTER (WHERE login_behaviour_tag = 'Morning Rider')  * 100.0 / COUNT(*), 1) AS morning_pct,
        ROUND(COUNT(*) FILTER (WHERE regularity_tag = 'Regular')             * 100.0 / COUNT(*), 1) AS regular_pct,
        ROUND(COUNT(*) FILTER (WHERE regularity_tag = 'Irregular')           * 100.0 / COUNT(*), 1) AS irregular_pct,
        ROUND(COUNT(*) FILTER (WHERE regularity_tag = 'New Rider')           * 100.0 / COUNT(*), 1) AS new_rider_pct
      FROM v_rider_summary
      WHERE 1=1 ${filterClause}
      GROUP BY hub, COALESCE(city, 'Unmapped')
      ORDER BY city, total_riders DESC
    `)

    // Rider-level — honours filters
    const riderRows = await query(`
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
      FROM v_rider_summary
      WHERE 1=1 ${filterClause}
      ORDER BY city NULLS LAST, hub, rider_id
    `)

    // Global KPI — always unfiltered (shows full picture)
    const [kpi] = await query(`
      SELECT
        COUNT(*)                                                               AS total_riders,
        COUNT(*) FILTER (WHERE login_behaviour_tag = 'Evening Rider')          AS evening_count,
        COUNT(*) FILTER (WHERE login_behaviour_tag = 'Cross Utilised')         AS cross_util_count,
        COUNT(*) FILTER (WHERE login_behaviour_tag = 'Morning Rider')          AS morning_count,
        COUNT(*) FILTER (WHERE regularity_tag = 'Regular')                     AS regular_count,
        COUNT(*) FILTER (WHERE regularity_tag = 'Irregular')                   AS irregular_count,
        COUNT(*) FILTER (WHERE regularity_tag = 'New Rider')                   AS new_rider_count
      FROM v_rider_summary
    `)

    // 3x3 matrix: regularity × behaviour (always unfiltered — global breakdown)
    const matrixRows = await query(`
      SELECT
        regularity_tag,
        login_behaviour_tag,
        COUNT(*) AS n
      FROM v_rider_summary
      GROUP BY regularity_tag, login_behaviour_tag
      ORDER BY regularity_tag, login_behaviour_tag
    `)

    // Build matrix as { Regular: { Evening: N, Cross: N, Morning: N }, Irregular: {...}, NewRider: {...} }
    type MatrixCell = { evening: number; cross: number; morning: number; total: number }
    const matrix: Record<string, MatrixCell> = {
      Regular:   { evening: 0, cross: 0, morning: 0, total: 0 },
      Irregular: { evening: 0, cross: 0, morning: 0, total: 0 },
      'New Rider': { evening: 0, cross: 0, morning: 0, total: 0 },
    }
    for (const r of matrixRows) {
      const reg = r.regularity_tag as string
      const beh = r.login_behaviour_tag as string
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
      cities: cityRows.map(r => ({
        city: r.city,
        zone: r.zone,
        totalRiders: Number(r.total_riders),
        eveningCount: Number(r.evening_count),
        crossUtilCount: Number(r.cross_util_count),
        morningCount: Number(r.morning_count),
        regularCount: Number(r.regular_count),
        irregularCount: Number(r.irregular_count),
        newRiderCount: Number(r.new_rider_count),
        eveningRiderPct: Number(r.evening_pct),
        crossUtilisedPct: Number(r.cross_util_pct),
        morningRiderPct: Number(r.morning_pct),
        regularPct: Number(r.regular_pct),
        irregularPct: Number(r.irregular_pct),
        newRiderPct: Number(r.new_rider_pct),
      })),
      hubs: hubRows.map(r => ({
        hub: r.hub,
        city: r.city,
        totalRiders: Number(r.total_riders),
        eveningCount: Number(r.evening_count),
        crossUtilCount: Number(r.cross_util_count),
        morningCount: Number(r.morning_count),
        regularCount: Number(r.regular_count),
        irregularCount: Number(r.irregular_count),
        newRiderCount: Number(r.new_rider_count),
        eveningRiderPct: Number(r.evening_pct),
        crossUtilisedPct: Number(r.cross_util_pct),
        morningRiderPct: Number(r.morning_pct),
        regularPct: Number(r.regular_pct),
        irregularPct: Number(r.irregular_pct),
        newRiderPct: Number(r.new_rider_pct),
      })),
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
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
