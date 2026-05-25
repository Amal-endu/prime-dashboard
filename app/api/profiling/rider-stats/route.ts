export const runtime = 'nodejs'
export const revalidate = 300
import { NextResponse } from 'next/server'
import { query } from '@/lib/supabase/sql'
import { apiError, parseWindowDays } from '@/lib/validators'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const riderId = searchParams.get('riderId')
  if (!riderId) return NextResponse.json({ error: 'riderId required' }, { status: 400 })

  const windowDays = parseWindowDays(searchParams.get('windowDays'), 30)

  try {
    const [anchor] = await query<{ anchor_date: string }>(
      'SELECT anchor_date::TEXT AS anchor_date FROM data_anchor WHERE id = 1'
    )
    const maxDateStr = anchor.anchor_date

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
      FROM rider_daily
      WHERE rider_id = $1
        AND date BETWEEN ($2::DATE - ($3 - 1) * INTERVAL '1 day')::DATE AND $2::DATE
    `, [riderId, maxDateStr, windowDays])

    // Earnings: morning = attempt_morning × base_pay; evening = delivered_3mr × total_pay
    const [earnings] = await query<Record<string, unknown>>(`
      WITH city_pay AS (
        SELECT hm.hub, c.base_pay, c.total_pay
        FROM hub_mapping hm
        LEFT JOIN cpo c ON LOWER(hm.city) = LOWER(c.city)
      ),
      morning_daily AS (
        SELECT
          rd.date,
          COALESCE(cp.base_pay, 0) * COALESCE(rd.attempt_morning, 0) AS morning_earn
        FROM rider_daily rd
        LEFT JOIN city_pay cp ON LOWER(rd.hub) = LOWER(cp.hub)
        WHERE rd.rider_id = $1
          AND rd.date BETWEEN ($2::DATE - ($3 - 1) * INTERVAL '1 day')::DATE AND $2::DATE
          AND rd.morning_runsheet_hour IS NOT NULL
      ),
      evening_daily AS (
        SELECT
          s.date,
          SUM(s.delivered_3mr::FLOAT * COALESCE(cp.total_pay, 0)) AS evening_earn
        FROM rider_day_shipments s
        LEFT JOIN city_pay cp ON LOWER(s.hub) = LOWER(cp.hub)
        WHERE s.rider_id = $1
          AND s.date BETWEEN ($2::DATE - ($3 - 1) * INTERVAL '1 day')::DATE AND $2::DATE
        GROUP BY s.date
      )
      SELECT
        ROUND(AVG(NULLIF(morning_earn, 0)), 0) AS avg_daily_earnings_morning,
        ROUND(AVG(NULLIF(evening_earn, 0)), 0) AS avg_daily_earnings_evening
      FROM morning_daily
      FULL OUTER JOIN evening_daily USING (date)
    `, [riderId, maxDateStr, windowDays])

    return NextResponse.json({
      avgAtpMorning: atp?.avg_atp_morning != null ? Number(atp.avg_atp_morning) : null,
      avgAtpEvening: atp?.avg_atp_evening != null ? Number(atp.avg_atp_evening) : null,
      avgLoginHourMorning: atp?.avg_login_hour_morning != null ? Number(atp.avg_login_hour_morning) : null,
      avgLoginHourEvening: atp?.avg_login_hour_evening != null ? Number(atp.avg_login_hour_evening) : null,
      avgDailyEarningsMorning: earnings?.avg_daily_earnings_morning != null ? Number(earnings.avg_daily_earnings_morning) : null,
      avgDailyEarningsEvening: earnings?.avg_daily_earnings_evening != null ? Number(earnings.avg_daily_earnings_evening) : null,
      favouriteClusterMorning: null,
      favouriteClusterEvening: null,
    })
  } catch (err) {
    console.error('[API /profiling/rider-stats]', err)
    const { status, body } = apiError(err)
    return NextResponse.json(body, { status })
  }
}
