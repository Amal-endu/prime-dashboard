export const runtime = 'nodejs'
import { NextResponse } from 'next/server'
import { query } from '@/backend/db'

// Returns combined raw_data + SDD_Data for a single rider on a date range
// Used for the rider drill-down expand panel in Rider Details
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const riderId = searchParams.get('riderId')
  const startDate = searchParams.get('start')
  const endDate = searchParams.get('end')

  if (!riderId || !startDate || !endDate) {
    return NextResponse.json({ error: 'riderId, start, end are required' }, { status: 400 })
  }

  const safe = (s: string) => s.replace(/'/g, "''")

  try {
    // Daily activity from raw_data (login behaviour)
    const loginRows = await query(`
      SELECT
        date::VARCHAR                AS date,
        hub,
        rider_name,
        morning_runsheet_hour,
        evening_runsheet_hour,
        COALESCE(attempt_morning, 0) AS attempt_morning,
        COALESCE(attempt_evening, 0) AS attempt_evening,
        COALESCE(attempted_total, 0) AS attempted_total
      FROM rider_daily
      WHERE rider_id = '${safe(riderId)}'
        AND date BETWEEN '${safe(startDate)}' AND '${safe(endDate)}'
      ORDER BY date DESC
    `)

    // 3MR delivery from sdd_awbs (via v_3mr_delivery view which already aggregates)
    const deliveryRows = await query(`
      SELECT
        d.date::VARCHAR              AS date,
        d.hub,
        d.assigned_3mr,
        d.attempted_3mr,
        d.delivered_3mr,
        d.breach_count,
        ROUND(d.attempted_3mr * 100.0 / NULLIF(d.assigned_3mr, 0), 1)  AS attempt_pct,
        ROUND(d.delivered_3mr * 100.0 / NULLIF(d.assigned_3mr, 0), 1)  AS del_pct,
        ROUND(d.delivered_3mr * COALESCE(c.total_pay, 0), 0)            AS earnings
      FROM v_3mr_delivery d
      LEFT JOIN hub_mapping hm ON d.hub = hm.hub
      LEFT JOIN cpo c ON hm.city = c.city
      WHERE d.rider_id = '${safe(riderId)}'
        AND d.date BETWEEN '${safe(startDate)}' AND '${safe(endDate)}'
      ORDER BY d.date DESC
    `)

    // Merge by date
    const loginByDate: Record<string, typeof loginRows[0]> = {}
    for (const r of loginRows) loginByDate[r.date as string] = r

    const deliveryByDate: Record<string, typeof deliveryRows[0]> = {}
    for (const r of deliveryRows) deliveryByDate[r.date as string] = r

    // Union of all dates
    const allDates = [...new Set([
      ...loginRows.map(r => r.date as string),
      ...deliveryRows.map(r => r.date as string),
    ])].sort((a, b) => b.localeCompare(a))

    const merged = allDates.map(date => {
      const l = loginByDate[date]
      const d = deliveryByDate[date]
      return {
        date,
        hub: (l?.hub ?? d?.hub ?? '') as string,
        riderName: (l?.rider_name ?? '') as string,
        morningRunsheetHour: l ? Number(l.morning_runsheet_hour) || null : null,
        eveningRunsheetHour: l ? Number(l.evening_runsheet_hour) || null : null,
        attemptMorning: l ? Number(l.attempt_morning) : null,
        attemptEvening: l ? Number(l.attempt_evening) : null,
        attemptedTotal: l ? Number(l.attempted_total) : null,
        assigned3MR: d ? Number(d.assigned_3mr) : null,
        attempted3MR: d ? Number(d.attempted_3mr) : null,
        delivered3MR: d ? Number(d.delivered_3mr) : null,
        breachCount: d ? Number(d.breach_count) : null,
        attemptPct: d ? Number(d.attempt_pct) : null,
        delPct: d ? Number(d.del_pct) : null,
        earnings: d ? Number(d.earnings) : null,
      }
    })

    // Summary totals
    const totalAssigned = deliveryRows.reduce((s, r) => s + Number(r.assigned_3mr), 0)
    const totalAttempted3MR = deliveryRows.reduce((s, r) => s + Number(r.attempted_3mr), 0)
    const totalDelivered = deliveryRows.reduce((s, r) => s + Number(r.delivered_3mr), 0)
    const totalEarnings = deliveryRows.reduce((s, r) => s + Number(r.earnings), 0)
    const loginDays = loginRows.length
    const daysWithEvening = loginRows.filter(r => r.evening_runsheet_hour != null).length
    const daysWithMorning = loginRows.filter(r => r.morning_runsheet_hour != null).length

    return NextResponse.json({
      days: merged,
      summary: {
        loginDays,
        daysWithMorning,
        daysWithEvening,
        totalAssigned,
        totalAttempted3MR,
        totalDelivered,
        avgAttemptPct: totalAssigned > 0 ? Math.round(totalAttempted3MR * 100 / totalAssigned * 10) / 10 : 0,
        avgDelPct: totalAssigned > 0 ? Math.round(totalDelivered * 100 / totalAssigned * 10) / 10 : 0,
        totalEarnings,
      },
    })
  } catch (err) {
    console.error('[API /details/joined]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
