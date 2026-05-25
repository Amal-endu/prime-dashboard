export const runtime = 'nodejs'
export const revalidate = 300
import { NextResponse } from 'next/server'
import { query } from '@/lib/supabase/sql'
import { apiError, parseMode } from '@/lib/validators'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function dateLabel(d: Date): { date: string; day: string; weekday: string } {
  const day = d.getDate().toString().padStart(2, '0')
  const month = d.toLocaleString('en-GB', { month: 'short' })
  return {
    date: fmtDate(d),
    day: `${day} ${month}`,
    weekday: WEEKDAYS[d.getDay()],
  }
}

function offset(base: Date, days: number): Date {
  const d = new Date(base)
  d.setDate(d.getDate() - days)
  return d
}

function buildCityDayQuery(col: string, dates: string[]): string {
  const placeholders = dates.map((_, i) => `$${i + 1}`).join(',')
  return `
    SELECT
      h.city,
      h.date::TEXT AS date,
      SUM(h.riders_active) AS riders,
      ROUND(SUM(h.attempted_${col})::FLOAT / NULLIF(SUM(h.riders_active), 0), 1) AS avg_productivity,
      ROUND(SUM(h.delivered_${col})::FLOAT * COALESCE(MAX(c.total_pay), 0) / NULLIF(SUM(h.riders_active), 0), 0) AS avg_earnings,
      ROUND(SUM(h.delivered_${col})::FLOAT / NULLIF(SUM(h.assigned_${col}), 0) * 100, 1) AS del_pct
    FROM hub_day_l8d h
    LEFT JOIN cpo c ON h.city = c.city
    WHERE h.date IN (${placeholders})
    GROUP BY h.city, h.date
    ORDER BY h.city, h.date
  `
}

function buildHubDayQuery(col: string, dates: string[]): string {
  const placeholders = dates.map((_, i) => `$${i + 1}`).join(',')
  return `
    SELECT
      h.hub,
      h.city,
      h.date::TEXT AS date,
      h.riders_active AS riders,
      ROUND(h.attempted_${col}::FLOAT / NULLIF(h.riders_active, 0), 1) AS avg_productivity,
      ROUND(h.delivered_${col}::FLOAT * COALESCE(c.total_pay, 0) / NULLIF(h.riders_active, 0), 0) AS avg_earnings,
      ROUND(h.delivered_${col}::FLOAT / NULLIF(h.assigned_${col}, 0) * 100, 1) AS del_pct
    FROM hub_day_l8d h
    LEFT JOIN cpo c ON h.city = c.city
    WHERE h.date IN (${placeholders})
    ORDER BY h.city, h.hub, h.date
  `
}

type RawRow = {
  city: string
  hub?: string
  date: string
  riders: number
  avg_productivity: number
  avg_earnings: number
  del_pct: number
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  try {
    const mode = parseMode(searchParams.get('mode'))
    const col = mode === 'overall' ? 'overall' : '3mr'

    const [anchor] = await query<{ anchor_date: string }>(
      'SELECT shipments_max::TEXT AS anchor_date FROM data_anchor WHERE id = 1'
    )
    const maxDate = new Date(anchor.anchor_date)

    const days = Array.from({ length: 8 }, (_, i) => {
      const d = offset(maxDate, i)
      return { ...dateLabel(d), idx: i }
    })

    const dateStrings = days.map(d => d.date)

    const [cityRows, hubRows] = await Promise.all([
      query<RawRow>(buildCityDayQuery(col, dateStrings), dateStrings),
      query<RawRow>(buildHubDayQuery(col, dateStrings), dateStrings),
    ])

    type DayMetrics = { riders: number; avgProductivity: number; avgEarnings: number; delPct: number }
    const empty: DayMetrics = { riders: 0, avgProductivity: 0, avgEarnings: 0, delPct: 0 }

    const cityMap: Record<string, Record<string, DayMetrics>> = {}
    for (const r of cityRows) {
      if (!cityMap[r.city]) cityMap[r.city] = {}
      cityMap[r.city][r.date] = {
        riders: Number(r.riders),
        avgProductivity: Number(r.avg_productivity),
        avgEarnings: Number(r.avg_earnings),
        delPct: Number(r.del_pct),
      }
    }

    const hubCityMap: Record<string, string> = {}
    const hubMap: Record<string, Record<string, DayMetrics>> = {}
    for (const r of hubRows) {
      const hub = r.hub!
      hubCityMap[hub] = r.city
      if (!hubMap[hub]) hubMap[hub] = {}
      hubMap[hub][r.date] = {
        riders: Number(r.riders),
        avgProductivity: Number(r.avg_productivity),
        avgEarnings: Number(r.avg_earnings),
        delPct: Number(r.del_pct),
      }
    }

    function weekAvgOf(dayMetrics: DayMetrics[]): DayMetrics {
      const tail = dayMetrics.slice(1)
      const activeDays = tail.filter(d => d.riders > 0)
      if (activeDays.length === 0) return empty
      return {
        riders: Math.round(activeDays.reduce((s, d) => s + d.riders, 0) / activeDays.length),
        avgProductivity: Math.round((activeDays.reduce((s, d) => s + d.avgProductivity, 0) / activeDays.length) * 10) / 10,
        avgEarnings: Math.round(activeDays.reduce((s, d) => s + d.avgEarnings, 0) / activeDays.length),
        delPct: Math.round((activeDays.reduce((s, d) => s + d.delPct, 0) / activeDays.length) * 10) / 10,
      }
    }

    const cities = Object.keys(cityMap).sort()
    const cityData = cities.map(city => {
      const dayMetrics = days.map(d => cityMap[city]?.[d.date] ?? empty)
      return { city, days: dayMetrics, weekAvg: weekAvgOf(dayMetrics) }
    })

    const hubsByCity: Record<string, string[]> = {}
    for (const hub of Object.keys(hubMap)) {
      const city = hubCityMap[hub]
      if (!hubsByCity[city]) hubsByCity[city] = []
      hubsByCity[city].push(hub)
    }
    for (const city of Object.keys(hubsByCity)) hubsByCity[city].sort()

    const hubData = Object.entries(hubsByCity).flatMap(([city, hubs]) =>
      hubs.map(hub => {
        const dayMetrics = days.map(d => hubMap[hub]?.[d.date] ?? empty)
        return { city, hub, days: dayMetrics, weekAvg: weekAvgOf(dayMetrics) }
      }),
    )

    const totalByDate: Record<string, { riders: number; attempts: number; delivered: number; earnings: number; riderCount: number; delPctSum: number }> = {}
    for (const r of cityRows) {
      if (!totalByDate[r.date]) totalByDate[r.date] = { riders: 0, attempts: 0, delivered: 0, earnings: 0, riderCount: 0, delPctSum: 0 }
      const t = totalByDate[r.date]
      const riders = Number(r.riders)
      t.riders += riders
      t.attempts += Number(r.avg_productivity) * riders
      t.delivered += Number(r.avg_earnings) * riders
      t.riderCount += riders
      t.delPctSum += Number(r.del_pct) * riders
    }

    const totalDays: DayMetrics[] = days.map(d => {
      const t = totalByDate[d.date]
      if (!t || t.riders === 0) return empty
      return {
        riders: t.riders,
        avgProductivity: t.riderCount > 0 ? Math.round((t.attempts / t.riderCount) * 10) / 10 : 0,
        avgEarnings: t.riderCount > 0 ? Math.round(t.delivered / t.riderCount) : 0,
        delPct: t.riderCount > 0 ? Math.round((t.delPctSum / t.riderCount) * 10) / 10 : 0,
      }
    })

    return NextResponse.json({
      dates: days.map(d => ({ date: d.date, day: d.day, weekday: d.weekday })),
      cities: cityData,
      hubs: hubData,
      total: totalDays,
      totalWeekAvg: weekAvgOf(totalDays),
    })
  } catch (err) {
    console.error('[API /details/trend]', err)
    const { status, body } = apiError(err)
    return NextResponse.json(body, { status })
  }
}
