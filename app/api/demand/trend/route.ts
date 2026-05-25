export const runtime = 'nodejs'
export const revalidate = 300
import { NextResponse } from 'next/server'
import { query } from '@/lib/supabase/sql'
import { apiError } from '@/lib/validators'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function dateLabel(d: Date): { date: string; day: string; weekday: string } {
  const day = d.getDate().toString().padStart(2, '0')
  const month = d.toLocaleString('en-GB', { month: 'short' })
  return { date: fmtDate(d), day: `${day} ${month}`, weekday: WEEKDAYS[d.getDay()] }
}

function offset(base: Date, days: number): Date {
  const d = new Date(base)
  d.setDate(d.getDate() - days)
  return d
}

type DayDemand = { totalOverall: number; total3MR: number; delPct3MR: number }

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  try {
    const primeOnly = searchParams.get('prime') === 'true'
    const clientFilter = searchParams.get('client')
    const hasClientFilter = clientFilter && clientFilter !== 'all' && clientFilter !== ''

    const [anchor] = await query<{ anchor_date: string }>(
      'SELECT anchor_date::TEXT AS anchor_date FROM data_anchor WHERE id = 1'
    )
    const maxDate = new Date(anchor.anchor_date)

    // 8 days: D-1 (today/anchor) through D-8
    const days = Array.from({ length: 8 }, (_, i) => ({ ...dateLabel(offset(maxDate, i)), idx: i }))
    const dateStrings = days.map(d => d.date)
    const placeholders = dateStrings.map((_, i) => `$${i + 1}`).join(',')

    // City-level overall and 3MR demand from hub_day_l8d
    // primeOnly and clientFilter are not filterable at city level (pre-aggregated)
    // client view uses client_day_shipments instead
    const cityRows = await query<{ city: string; date: string; total_overall: number; total_3mr: number; delivered_3mr: number }>(
      `SELECT
        city,
        date::TEXT AS date,
        SUM(assigned_overall) AS total_overall,
        SUM(assigned_3mr)     AS total_3mr,
        SUM(delivered_3mr)    AS delivered_3mr
       FROM hub_day_l8d
       WHERE date IN (${placeholders})
       GROUP BY city, date
       ORDER BY city, date`,
      dateStrings
    )

    // Client-level trend (used when clientFilter is set or primeOnly)
    let clientRows: { date: string; total_3mr: number; delivered_3mr: number; total_overall: number }[] = []
    if (hasClientFilter || primeOnly) {
      const primeFilter = primeOnly ? 'AND is_prime = TRUE' : ''
      const clientWhere = hasClientFilter ? `AND LOWER(client_name) = LOWER($${dateStrings.length + 1})` : ''
      const params: unknown[] = [...dateStrings]
      if (hasClientFilter) params.push(clientFilter)
      clientRows = await query(
        `SELECT
          date::TEXT AS date,
          SUM(awbs_3mr)      AS total_3mr,
          SUM(delivered_3mr) AS delivered_3mr,
          SUM(awbs_overall)  AS total_overall
         FROM client_day_shipments
         WHERE date IN (${placeholders})
           AND client_name IS NOT NULL
           ${primeFilter}
           ${clientWhere}
         GROUP BY date
         ORDER BY date`,
        params
      )
    }

    const overallMap: Record<string, Record<string, number>> = {}
    const mr3Map: Record<string, Record<string, { total: number; delivered: number }>> = {}

    if (hasClientFilter || primeOnly) {
      // Flatten filtered client data under a synthetic city "Filtered"
      const filteredCity = hasClientFilter ? (clientFilter as string) : 'Prime'
      overallMap[filteredCity] = {}
      mr3Map[filteredCity] = {}
      for (const r of clientRows) {
        overallMap[filteredCity][r.date] = Number(r.total_overall)
        mr3Map[filteredCity][r.date] = { total: Number(r.total_3mr), delivered: Number(r.delivered_3mr) }
      }
    } else {
      for (const r of cityRows) {
        if (!overallMap[r.city]) overallMap[r.city] = {}
        overallMap[r.city][r.date] = Number(r.total_overall)
        if (!mr3Map[r.city]) mr3Map[r.city] = {}
        mr3Map[r.city][r.date] = { total: Number(r.total_3mr), delivered: Number(r.delivered_3mr) }
      }
    }

    const allCities = Array.from(new Set([...Object.keys(overallMap), ...Object.keys(mr3Map)])).sort()
    const empty: DayDemand = { totalOverall: 0, total3MR: 0, delPct3MR: 0 }

    function weekAvgOf(dayMetrics: DayDemand[]): DayDemand {
      const tail = dayMetrics.slice(1)
      const active = tail.filter(d => d.totalOverall > 0 || d.total3MR > 0)
      if (active.length === 0) return empty
      return {
        totalOverall: Math.round(active.reduce((s, d) => s + d.totalOverall, 0) / active.length),
        total3MR: Math.round(active.reduce((s, d) => s + d.total3MR, 0) / active.length),
        delPct3MR: Math.round((active.reduce((s, d) => s + d.delPct3MR, 0) / active.length) * 10) / 10,
      }
    }

    const cityData = allCities.map(city => {
      const dayMetrics: DayDemand[] = days.map(d => {
        const overall = overallMap[city]?.[d.date] ?? 0
        const mr3 = mr3Map[city]?.[d.date] ?? { total: 0, delivered: 0 }
        const delPct = mr3.total > 0 ? Math.round((mr3.delivered / mr3.total) * 1000) / 10 : 0
        return { totalOverall: overall, total3MR: mr3.total, delPct3MR: delPct }
      })
      return { city, days: dayMetrics, weekAvg: weekAvgOf(dayMetrics) }
    })

    const totalByDate: DayDemand[] = days.map(d => {
      let overall = 0; let mr3 = 0; let delivered = 0
      for (const city of allCities) {
        overall += overallMap[city]?.[d.date] ?? 0
        const m = mr3Map[city]?.[d.date]
        if (m) { mr3 += m.total; delivered += m.delivered }
      }
      return { totalOverall: overall, total3MR: mr3, delPct3MR: mr3 > 0 ? Math.round((delivered / mr3) * 1000) / 10 : 0 }
    })

    return NextResponse.json({
      dates: days.map(({ date, day, weekday }) => ({ date, day, weekday })),
      cities: cityData,
      total: totalByDate,
      totalWeekAvg: weekAvgOf(totalByDate),
    })
  } catch (err) {
    console.error('[API /demand/trend]', err)
    const { status, body } = apiError(err)
    return NextResponse.json(body, { status })
  }
}
