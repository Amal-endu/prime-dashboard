export const runtime = 'nodejs'
export const revalidate = 300
import { NextResponse } from 'next/server'
import { query } from '@/backend/db'
import { apiError, parseWindowDays, parseHour } from '@/lib/validators'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const riderId = searchParams.get('riderId')
  if (!riderId) return NextResponse.json({ error: 'riderId required' }, { status: 400 })

  const windowDays   = parseWindowDays(searchParams.get('windowDays'), 30)
  const mr3CutoffHour = parseHour(searchParams.get('mr3CutoffHour'), 15)

  try {
    // ATP productivity: avg attempts per login day (morning and evening separately)
    const [atp] = await query<Record<string, unknown>>(`
      SELECT
        ROUND(AVG(CASE WHEN morning_runsheet_hour IS NOT NULL AND attempt_morning > 0
          THEN attempt_morning END), 1) AS avg_atp_morning,
        ROUND(AVG(CASE WHEN evening_runsheet_hour IS NOT NULL AND attempt_evening > 0
          THEN attempt_evening END), 1) AS avg_atp_evening,
        ROUND(AVG(CASE WHEN morning_runsheet_hour IS NOT NULL
          THEN morning_runsheet_hour END), 1) AS avg_login_hour_morning,
        ROUND(AVG(CASE WHEN evening_runsheet_hour IS NOT NULL
          THEN evening_runsheet_hour END), 1) AS avg_login_hour_evening
      FROM rider_daily rd
      CROSS JOIN (SELECT max_date FROM v_max_date) mx
      WHERE rd.rider_id = ?
        AND rd.date BETWEEN (mx.max_date - INTERVAL (?::INTEGER - 1) DAY) AND mx.max_date
    `, [riderId, windowDays])

    // Earnings:
    // Morning: rider_daily.attempt_morning × base_pay — uses full runsheet (SDD + NDD)
    //          sdd_awbs only has SDD orders, severely undercounting morning NDD workload
    // Evening: sdd_awbs delivered × total_pay — evening is almost entirely 3MR/SDD so coverage is complete
    const [earnings] = await query<Record<string, unknown>>(`
      WITH mx AS (SELECT max_date FROM v_max_date),
      city_pay AS (
        SELECT hm.hub, c.base_pay, c.total_pay
        FROM hub_mapping hm
        LEFT JOIN cpo c ON LOWER(hm.city) = LOWER(c.city)
      ),
      morning_daily AS (
        SELECT
          rd.date,
          COALESCE(cp.base_pay, 0) * COALESCE(rd.attempt_morning, 0) AS morning_earn
        FROM rider_daily rd
        CROSS JOIN mx
        LEFT JOIN city_pay cp ON LOWER(rd.hub) = LOWER(cp.hub)
        WHERE rd.rider_id = ?
          AND rd.date BETWEEN (mx.max_date - INTERVAL (?::INTEGER - 1) DAY) AND mx.max_date
          AND rd.morning_runsheet_hour IS NOT NULL
      ),
      evening_daily AS (
        SELECT
          a.date,
          SUM(COALESCE(cp.total_pay, 0)) AS evening_earn
        FROM sdd_awbs a
        CROSS JOIN mx
        LEFT JOIN city_pay cp ON LOWER(a.hub) = LOWER(cp.hub)
        WHERE a.rider_id = ?
          AND a.date BETWEEN (mx.max_date - INTERVAL (?::INTEGER - 1) DAY) AND mx.max_date
          AND a.latest_status = 'DELIVERED'
          AND HOUR(a.received_at_hub_time) >= ?::INTEGER
        GROUP BY a.date
      )
      SELECT
        ROUND(AVG(NULLIF(morning_earn, 0)), 0) AS avg_daily_earnings_morning,
        ROUND(AVG(NULLIF(evening_earn, 0)), 0) AS avg_daily_earnings_evening
      FROM morning_daily
      FULL OUTER JOIN evening_daily USING (date)
    `, [riderId, windowDays, riderId, windowDays, mr3CutoffHour])

    // Favourite cluster: most attempted AWBs by cluster, split morning/evening
    const clusterRows = await query<Record<string, unknown>>(`
      SELECT
        CASE WHEN HOUR(received_at_hub_time) < ?::INTEGER THEN 'morning' ELSE 'evening' END AS run,
        COALESCE(NULLIF(TRIM(cluster_name), ''), 'Unknown') AS cluster,
        COUNT(*) AS attempts
      FROM sdd_awbs
      CROSS JOIN (SELECT max_date FROM v_max_date) mx
      WHERE rider_id = ?
        AND date BETWEEN (mx.max_date - INTERVAL (?::INTEGER - 1) DAY) AND mx.max_date
        AND cluster_name IS NOT NULL
        AND TRIM(cluster_name) != ''
      GROUP BY run, cluster
      ORDER BY run, attempts DESC
    `, [mr3CutoffHour, riderId, windowDays])

    const favouriteCluster: { morning: string | null; evening: string | null } = { morning: null, evening: null }
    const seen = { morning: false, evening: false }
    for (const r of clusterRows) {
      const run = r.run as 'morning' | 'evening'
      if (!seen[run]) { favouriteCluster[run] = r.cluster as string; seen[run] = true }
    }

    return NextResponse.json({
      avgAtpMorning: atp?.avg_atp_morning != null ? Number(atp.avg_atp_morning) : null,
      avgAtpEvening: atp?.avg_atp_evening != null ? Number(atp.avg_atp_evening) : null,
      avgLoginHourMorning: atp?.avg_login_hour_morning != null ? Number(atp.avg_login_hour_morning) : null,
      avgLoginHourEvening: atp?.avg_login_hour_evening != null ? Number(atp.avg_login_hour_evening) : null,
      avgDailyEarningsMorning: earnings?.avg_daily_earnings_morning != null ? Number(earnings.avg_daily_earnings_morning) : null,
      avgDailyEarningsEvening: earnings?.avg_daily_earnings_evening != null ? Number(earnings.avg_daily_earnings_evening) : null,
      favouriteClusterMorning: favouriteCluster.morning,
      favouriteClusterEvening: favouriteCluster.evening,
    })
  } catch (err) {
    console.error('[API /profiling/rider-stats]', err)
    const { status, body } = apiError(err)
    return NextResponse.json(body, { status })
  }
}
