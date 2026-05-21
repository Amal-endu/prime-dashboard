export const runtime = 'nodejs'
export const revalidate = 300
import { NextResponse } from 'next/server'
import { query } from '@/backend/db'
import { ValidationError, apiError, parseIsoDate } from '@/lib/validators'

// Combined raw_data + SDD_Data for a single rider on a date range.
// Used by the rider drill-down expand panel in Rider Details.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  try {
    const riderId = searchParams.get('riderId')
    const startDate = parseIsoDate(searchParams.get('start'), 'start')
    const endDate = parseIsoDate(searchParams.get('end'), 'end')

    if (!riderId || !startDate || !endDate) {
      throw new ValidationError('riderId, start, end are required')
    }
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(riderId)) {
      throw new ValidationError('invalid riderId')
    }

    const loginRows = await query<Record<string, unknown>>(
      `SELECT
         date::VARCHAR                AS date,
         hub,
         rider_name,
         morning_runsheet_hour,
         evening_runsheet_hour,
         COALESCE(attempt_morning, 0) AS attempt_morning,
         COALESCE(attempt_evening, 0) AS attempt_evening,
         COALESCE(attempted_total, 0) AS attempted_total
       FROM rider_daily
       WHERE rider_id = ?
         AND date BETWEEN ? AND ?
       ORDER BY date DESC`,
      [riderId, startDate, endDate],
    )

    const deliveryRows = await query<Record<string, unknown>>(
      `SELECT
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
       WHERE d.rider_id = ?
         AND d.date BETWEEN ? AND ?
       ORDER BY d.date DESC`,
      [riderId, startDate, endDate],
    )

    const loginByDate: Record<string, Record<string, unknown>> = {}
    for (const r of loginRows) loginByDate[r.date as string] = r
    const deliveryByDate: Record<string, Record<string, unknown>> = {}
    for (const r of deliveryRows) deliveryByDate[r.date as string] = r

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
    const { status, body } = apiError(err)
    return NextResponse.json(body, { status })
  }
}
