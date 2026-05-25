export const runtime = 'nodejs'
export const revalidate = 300
import { NextResponse } from 'next/server'
import { query } from '@/lib/supabase/sql'
import {
  apiError,
  parseDatePreset,
  resolveDateRange,
} from '@/lib/validators'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  try {
    const datePreset = parseDatePreset(searchParams.get('date'))

    const [anchor] = await query<{ anchor_date: string }>(
      'SELECT anchor_date::TEXT AS anchor_date FROM data_anchor WHERE id = 1'
    )
    const maxDate = new Date(anchor.anchor_date)
    const maxDateStr = anchor.anchor_date
    const { startDate, endDate } = resolveDateRange(datePreset, maxDate)

    const cityRows = await query<Record<string, unknown>>(`
      SELECT
        h.city,
        SUM(h.assigned_3mr) AS orders_3mr,
        SUM(h.delivered_3mr) AS delivered_3mr,
        ROUND(SUM(h.delivered_3mr)::NUMERIC / NULLIF(SUM(h.assigned_3mr), 0) * 100, 1) AS del_pct,
        SUM(h.breach_count_3mr) AS breach_count,
        ROUND(SUM(h.breach_count_3mr)::NUMERIC / NULLIF(SUM(h.assigned_3mr), 0) * 100, 1) AS breach_pct
      FROM hub_day_l8d h
      WHERE h.date BETWEEN $1 AND $2
      GROUP BY h.city
      ORDER BY h.city
    `, [startDate, endDate])

    const hubRows = await query<Record<string, unknown>>(`
      SELECT
        h.hub, h.city,
        SUM(h.assigned_3mr) AS orders_3mr,
        SUM(h.delivered_3mr) AS delivered_3mr,
        ROUND(SUM(h.delivered_3mr)::NUMERIC / NULLIF(SUM(h.assigned_3mr), 0) * 100, 1) AS del_pct,
        SUM(h.breach_count_3mr) AS breach_count,
        ROUND(SUM(h.breach_count_3mr)::NUMERIC / NULLIF(SUM(h.assigned_3mr), 0) * 100, 1) AS breach_pct
      FROM hub_day_l8d h
      WHERE h.date BETWEEN $1 AND $2
      GROUP BY h.hub, h.city
      ORDER BY h.city, h.hub
    `, [startDate, endDate])

    const riderRows = await query<Record<string, unknown>>(`
      SELECT
        s.rider_id,
        MAX(rd.rider_name) AS rider_name,
        s.hub,
        COALESCE(hm.city, 'Unmapped') AS city,
        SUM(s.assigned_3mr) AS orders_3mr,
        SUM(s.delivered_3mr) AS delivered_3mr,
        ROUND(SUM(s.delivered_3mr)::NUMERIC / NULLIF(SUM(s.assigned_3mr), 0) * 100, 1) AS del_pct,
        SUM(s.breach_count_3mr) AS breach_count
      FROM rider_day_shipments s
      LEFT JOIN hub_mapping hm ON LOWER(s.hub) = LOWER(hm.hub)
      LEFT JOIN rider_daily rd ON rd.rider_id = s.rider_id AND rd.date = s.date
      WHERE s.date BETWEEN $1 AND $2
      GROUP BY s.rider_id, s.hub, hm.city
      ORDER BY city, s.hub, s.rider_id
      LIMIT 5000
    `, [startDate, endDate])

    // L7D and L30D city-level delivery trends from hub_day_l8d
    const trendRows7 = await query<Record<string, unknown>>(`
      SELECT
        city,
        SUM(CASE WHEN date BETWEEN ($1::DATE - INTERVAL '6 days') AND $1::DATE
            THEN delivered_3mr ELSE 0 END)::NUMERIC AS curr_del,
        SUM(CASE WHEN date BETWEEN ($1::DATE - INTERVAL '6 days') AND $1::DATE
            THEN assigned_3mr ELSE 0 END)::NUMERIC AS curr_ord,
        SUM(CASE WHEN date BETWEEN ($1::DATE - INTERVAL '13 days') AND ($1::DATE - INTERVAL '7 days')
            THEN delivered_3mr ELSE 0 END)::NUMERIC AS prev_del,
        SUM(CASE WHEN date BETWEEN ($1::DATE - INTERVAL '13 days') AND ($1::DATE - INTERVAL '7 days')
            THEN assigned_3mr ELSE 0 END)::NUMERIC AS prev_ord
      FROM hub_day_l8d
      GROUP BY city
    `, [maxDateStr])

    const trendRows30 = await query<Record<string, unknown>>(`
      SELECT
        h.city,
        SUM(CASE WHEN h.date BETWEEN ($1::DATE - INTERVAL '29 days') AND $1::DATE
            THEN h.delivered_3mr ELSE 0 END)::NUMERIC AS curr_del,
        SUM(CASE WHEN h.date BETWEEN ($1::DATE - INTERVAL '29 days') AND $1::DATE
            THEN h.assigned_3mr ELSE 0 END)::NUMERIC AS curr_ord,
        SUM(CASE WHEN h.date BETWEEN ($1::DATE - INTERVAL '59 days') AND ($1::DATE - INTERVAL '30 days')
            THEN h.delivered_3mr ELSE 0 END)::NUMERIC AS prev_del,
        SUM(CASE WHEN h.date BETWEEN ($1::DATE - INTERVAL '59 days') AND ($1::DATE - INTERVAL '30 days')
            THEN h.assigned_3mr ELSE 0 END)::NUMERIC AS prev_ord
      FROM rider_day_shipments s
      LEFT JOIN hub_mapping hm ON LOWER(s.hub) = LOWER(hm.hub)
      RIGHT JOIN hub_day_l8d h ON h.hub = s.hub AND h.date = s.date
      GROUP BY h.city
    `, [maxDateStr])

    const toNum = (v: unknown) => v == null ? 0 : Number(v)

    type TrendEntry = { delPct: number; prevDelPct: number; delta: number }
    const buildTrend = (rows: Record<string, unknown>[]) => {
      const map: Record<string, TrendEntry> = {}
      for (const r of rows) {
        const city = r.city as string
        const currDelPct = toNum(r.curr_ord) > 0 ? toNum(r.curr_del) / toNum(r.curr_ord) * 100 : 0
        const prevDelPct = toNum(r.prev_ord) > 0 ? toNum(r.prev_del) / toNum(r.prev_ord) * 100 : 0
        map[city] = { delPct: Math.round(currDelPct * 10) / 10, prevDelPct: Math.round(prevDelPct * 10) / 10, delta: Math.round((currDelPct - prevDelPct) * 10) / 10 }
      }
      return map
    }
    const trend7Map = buildTrend(trendRows7)
    const trend30Map = buildTrend(trendRows30)

    return NextResponse.json({
      dateRange: { start: startDate, end: endDate, preset: searchParams.get('date') ?? 'today' },
      cities: cityRows.map(r => ({
        city: r.city as string,
        orders3MR: toNum(r.orders_3mr),
        delivered3MR: toNum(r.delivered_3mr),
        delPct: toNum(r.del_pct),
        breachCount: toNum(r.breach_count),
        breachPct: toNum(r.breach_pct),
        trend7: trend7Map[r.city as string] ?? { delPct: 0, prevDelPct: 0, delta: 0 },
        trend30: trend30Map[r.city as string] ?? { delPct: 0, prevDelPct: 0, delta: 0 },
      })),
      hubs: hubRows.map(r => ({
        hub: r.hub,
        city: r.city ?? '',
        orders3MR: toNum(r.orders_3mr),
        delivered3MR: toNum(r.delivered_3mr),
        delPct: toNum(r.del_pct),
        breachCount: toNum(r.breach_count),
        breachPct: toNum(r.breach_pct),
      })),
      riders: riderRows.map(r => ({
        riderId: Number(r.rider_id),
        riderName: r.rider_name ?? '',
        hub: r.hub ?? '',
        city: r.city ?? '',
        behaviourTag: 'Morning Rider',
        regularityTag: 'Regular',
        orders3MR: toNum(r.orders_3mr),
        delivered3MR: toNum(r.delivered_3mr),
        delPct: toNum(r.del_pct),
        breachCount: toNum(r.breach_count),
      })),
    })
  } catch (err) {
    console.error('[API /delivery]', err)
    const { status, body } = apiError(err)
    return NextResponse.json(body, { status })
  }
}
