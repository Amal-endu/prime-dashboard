export const runtime = 'nodejs'
export const revalidate = 300
import { NextResponse } from 'next/server'
import { query } from '@/lib/supabase/sql'
import {
  apiError,
  parseDatePreset,
  parseMode,
  resolveDateRange,
} from '@/lib/validators'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)

  try {
    const mode = parseMode(searchParams.get('mode'))
    const datePreset = parseDatePreset(searchParams.get('date'))
    const col = mode === 'overall' ? 'overall' : '3mr'

    const [anchor] = await query<{ anchor_date: string }>(
      'SELECT shipments_max::TEXT AS anchor_date FROM data_anchor WHERE id = 1'
    )
    const maxDate = new Date(anchor.anchor_date)
    const { startDate, endDate } = resolveDateRange(datePreset, maxDate)

    const cityRows = await query<Record<string, unknown>>(`
      SELECT
        h.city,
        SUM(h.riders_active) AS riders_active,
        SUM(h.assigned_${col}) AS assigned_3mr,
        SUM(h.attempted_${col}) AS attempted_3mr,
        SUM(h.delivered_${col}) AS delivered_3mr,
        ROUND(SUM(h.attempted_${col})::FLOAT / NULLIF(SUM(h.assigned_${col}), 0) * 100, 1) AS attempt_prod_pct,
        ROUND(SUM(h.delivered_${col})::FLOAT / NULLIF(SUM(h.assigned_${col}), 0) * 100, 1) AS delivered_prod_pct,
        ROUND(SUM(h.delivered_${col})::FLOAT * COALESCE(MAX(c.total_pay), 0), 0) AS total_earnings
      FROM hub_day_l8d h
      LEFT JOIN cpo c ON h.city = c.city
      WHERE h.date BETWEEN $1 AND $2
      GROUP BY h.city
      ORDER BY SUM(h.delivered_${col}) DESC
    `, [startDate, endDate])

    const hubRows = await query<Record<string, unknown>>(`
      SELECT
        h.hub,
        h.city,
        SUM(h.riders_active) AS riders_active,
        SUM(h.assigned_${col}) AS assigned_3mr,
        SUM(h.attempted_${col}) AS attempted_3mr,
        SUM(h.delivered_${col}) AS delivered_3mr,
        ROUND(SUM(h.attempted_${col})::FLOAT / NULLIF(SUM(h.assigned_${col}), 0) * 100, 1) AS attempt_prod_pct,
        ROUND(SUM(h.delivered_${col})::FLOAT / NULLIF(SUM(h.assigned_${col}), 0) * 100, 1) AS delivered_prod_pct,
        ROUND(SUM(h.delivered_${col})::FLOAT * COALESCE(MAX(c.total_pay), 0), 0) AS total_earnings
      FROM hub_day_l8d h
      LEFT JOIN cpo c ON h.city = c.city
      WHERE h.date BETWEEN $1 AND $2
      GROUP BY h.hub, h.city
      ORDER BY h.city, SUM(h.delivered_${col}) DESC
    `, [startDate, endDate])

    const riderRows = await query<Record<string, unknown>>(`
      SELECT
        s.rider_id,
        MAX(rd.rider_name) AS rider_name,
        s.hub,
        COALESCE(hm.city, 'Unmapped') AS city,
        SUM(s.assigned_${col}) AS assigned_3mr,
        SUM(s.attempted_${col}) AS attempted_3mr,
        SUM(s.delivered_${col}) AS delivered_3mr,
        ROUND(SUM(s.attempted_${col})::FLOAT / NULLIF(SUM(s.assigned_${col}), 0) * 100, 1) AS attempt_prod_pct,
        ROUND(SUM(s.delivered_${col})::FLOAT / NULLIF(SUM(s.assigned_${col}), 0) * 100, 1) AS delivered_prod_pct,
        ROUND(SUM(s.delivered_${col})::FLOAT * COALESCE(MAX(c.total_pay), 0), 0) AS earnings_3mr,
        ROUND(AVG(CASE WHEN rd.attempt_morning > 0 THEN rd.attempt_morning END), 1) AS avg_morning_productivity,
        ROUND(AVG(CASE WHEN rd.attempt_evening > 0 THEN rd.attempt_evening END), 1) AS avg_evening_productivity,
        ROUND(AVG(CASE WHEN rd.morning_runsheet_hour IS NOT NULL THEN rd.morning_runsheet_hour END), 1) AS avg_morning_runsheet_hr,
        ROUND(AVG(CASE WHEN rd.evening_runsheet_hour IS NOT NULL THEN rd.evening_runsheet_hour END), 1) AS avg_evening_runsheet_hr
      FROM rider_day_shipments s
      LEFT JOIN hub_mapping hm ON LOWER(s.hub) = LOWER(hm.hub)
      LEFT JOIN rider_daily rd ON rd.rider_id = s.rider_id AND rd.date = s.date
      LEFT JOIN cpo c ON hm.city = c.city
      WHERE s.date BETWEEN $1 AND $2
      GROUP BY s.rider_id, s.hub, hm.city
      ORDER BY city, s.hub, SUM(s.delivered_${col}) DESC NULLS LAST
    `, [startDate, endDate])

    const toNum = (v: unknown) => v == null ? 0 : Number(v)

    return NextResponse.json({
      dateRange: { start: startDate, end: endDate },
      mode,
      cities: cityRows.map(r => ({
        city: r.city,
        ridersLoggedIn: toNum(r.riders_active),
        assigned3MR: toNum(r.assigned_3mr),
        attempted3MR: toNum(r.attempted_3mr),
        delivered3MR: toNum(r.delivered_3mr),
        avgAttemptProductivityPct: toNum(r.attempt_prod_pct),
        avgDeliveredProductivityPct: toNum(r.delivered_prod_pct),
        totalEarnings3MR: toNum(r.total_earnings),
      })),
      hubs: hubRows.map(r => ({
        hub: r.hub,
        city: r.city,
        ridersLoggedIn: toNum(r.riders_active),
        assigned3MR: toNum(r.assigned_3mr),
        attempted3MR: toNum(r.attempted_3mr),
        delivered3MR: toNum(r.delivered_3mr),
        avgAttemptProductivityPct: toNum(r.attempt_prod_pct),
        avgDeliveredProductivityPct: toNum(r.delivered_prod_pct),
        totalEarnings3MR: toNum(r.total_earnings),
      })),
      riders: riderRows.map(r => ({
        riderId: String(r.rider_id),
        riderName: r.rider_name ?? '',
        hub: r.hub ?? '',
        city: r.city ?? '',
        loginBehaviourTag: 'Morning Rider',
        regularityTag: 'Regular',
        assigned3MR: toNum(r.assigned_3mr),
        attempted3MR: toNum(r.attempted_3mr),
        delivered3MR: toNum(r.delivered_3mr),
        attemptProductivityPct: toNum(r.attempt_prod_pct),
        deliveredProductivityPct: toNum(r.delivered_prod_pct),
        earnings3MR: toNum(r.earnings_3mr),
        avgMorningProductivity: r.avg_morning_productivity != null ? Number(r.avg_morning_productivity) : null,
        avgEveningProductivity: r.avg_evening_productivity != null ? Number(r.avg_evening_productivity) : null,
        avgMorningRunsheetHr: r.avg_morning_runsheet_hr != null ? Number(r.avg_morning_runsheet_hr) : null,
        avgEveningRunsheetHr: r.avg_evening_runsheet_hr != null ? Number(r.avg_evening_runsheet_hr) : null,
      })),
    })
  } catch (err) {
    console.error('[API /details]', err)
    const { status, body } = apiError(err)
    return NextResponse.json(body, { status })
  }
}
