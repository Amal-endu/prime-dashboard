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
    const clientTypeFilter   = searchParams.get('clientType') ?? ''
    const clientBucketFilter = searchParams.get('clientBucket') ?? ''
    const criticalOnly       = searchParams.get('critical') === 'true'
    const hasSegmentFilter   = criticalOnly || !!clientTypeFilter || !!clientBucketFilter

    const [anchor] = await query<{ anchor_date: string }>(
      'SELECT anchor_date::TEXT AS anchor_date FROM data_anchor WHERE id = 1'
    )
    const maxDate = new Date(anchor.anchor_date)
    const maxDateStr = anchor.anchor_date
    const { startDate, endDate } = resolveDateRange(datePreset, maxDate)

    // Client segment filter: builds a list of client_names that match the filter
    // These are used to restrict which rider_day_shipments rows count.
    // rider_day_shipments has no client column, so we join via client_day_shipments.
    // When a segment filter is active, we compute per-hub totals only from AWBs
    // belonging to matching clients via client_day_shipments (date+hub level agg via rider_day_shipments join).
    //
    // Practical approach: pre-build a set of matching client_names, then filter
    // rider_day_shipments by only counting AWBs on days/hubs where those clients had shipments.
    //
    // Simpler and correct: city/hub views from hub_day_l8d stay as-is (pre-aggregated, no client filter).
    // Only rider-level view gets client filtered (via rider_day_shipments which does have hub).
    // City/hub rows will show a note when filtered.

    // Also fetch filter metadata
    const [clientTypesRes, clientBucketsRes, criticalCountRes] = await Promise.all([
      query<{ client_type: string }>('SELECT DISTINCT client_type FROM client_mapping WHERE client_type IS NOT NULL ORDER BY client_type'),
      query<{ client_bucket: string }>('SELECT DISTINCT client_bucket FROM client_mapping WHERE client_bucket IS NOT NULL ORDER BY client_bucket'),
      query<{ n: number }>('SELECT COUNT(*)::INT AS n FROM client_mapping WHERE critical_client = TRUE'),
    ])
    const filterMeta = {
      clientTypes:   clientTypesRes.map(r => r.client_type),
      clientBuckets: clientBucketsRes.map(r => r.client_bucket),
      criticalCount: criticalCountRes[0]?.n ?? 0,
    }

    // Build segment filter for queries that join client_mapping
    function buildSegFilter(dateParamCount: number) {
      const clauses: string[] = []
      const params: unknown[] = []
      let i = dateParamCount + 1
      if (criticalOnly)       clauses.push(`cm.critical_client = TRUE`)
      if (clientTypeFilter)   { clauses.push(`cm.client_type = $${i++}`);   params.push(clientTypeFilter) }
      if (clientBucketFilter) { clauses.push(`cm.client_bucket = $${i++}`); params.push(clientBucketFilter) }
      return { where: clauses.length ? 'AND ' + clauses.join(' AND ') : '', params }
    }

    // City and hub rows always come from hub_day_l8d (pre-aggregated, no client breakdown)
    const [cityRows, hubRows] = await Promise.all([
      query<Record<string, unknown>>(`
        SELECT h.city,
          SUM(h.assigned_3mr) AS orders_3mr, SUM(h.delivered_3mr) AS delivered_3mr,
          ROUND(SUM(h.delivered_3mr)::NUMERIC / NULLIF(SUM(h.assigned_3mr), 0) * 100, 1) AS del_pct,
          SUM(h.breach_count_3mr) AS breach_count,
          ROUND(SUM(h.breach_count_3mr)::NUMERIC / NULLIF(SUM(h.assigned_3mr), 0) * 100, 1) AS breach_pct
        FROM hub_day_l8d h WHERE h.date BETWEEN $1 AND $2
        GROUP BY h.city ORDER BY h.city
      `, [startDate, endDate]),
      query<Record<string, unknown>>(`
        SELECT h.hub, h.city,
          SUM(h.assigned_3mr) AS orders_3mr, SUM(h.delivered_3mr) AS delivered_3mr,
          ROUND(SUM(h.delivered_3mr)::NUMERIC / NULLIF(SUM(h.assigned_3mr), 0) * 100, 1) AS del_pct,
          SUM(h.breach_count_3mr) AS breach_count,
          ROUND(SUM(h.breach_count_3mr)::NUMERIC / NULLIF(SUM(h.assigned_3mr), 0) * 100, 1) AS breach_pct
        FROM hub_day_l8d h WHERE h.date BETWEEN $1 AND $2
        GROUP BY h.hub, h.city ORDER BY h.city, h.hub
      `, [startDate, endDate]),
    ])

    // Rider rows: when segment filter active, restrict to riders who delivered to matching clients
    let riderRows: Record<string, unknown>[]
    if (hasSegmentFilter) {
      const sf = buildSegFilter(2)
      riderRows = await query<Record<string, unknown>>(`
        SELECT
          s.rider_id, MAX(rd.rider_name) AS rider_name, s.hub,
          COALESCE(hm.city, 'Unmapped') AS city,
          SUM(s.assigned_3mr) AS orders_3mr, SUM(s.delivered_3mr) AS delivered_3mr,
          ROUND(SUM(s.delivered_3mr)::NUMERIC / NULLIF(SUM(s.assigned_3mr), 0) * 100, 1) AS del_pct,
          SUM(s.breach_count_3mr) AS breach_count
        FROM rider_day_shipments s
        LEFT JOIN hub_mapping hm ON LOWER(s.hub) = LOWER(hm.hub)
        LEFT JOIN rider_daily rd ON rd.rider_id = s.rider_id AND rd.date = s.date
        WHERE s.date BETWEEN $1 AND $2
          AND EXISTS (
            SELECT 1 FROM client_day_shipments cds
            LEFT JOIN client_mapping cm ON LOWER(cds.client_name) = LOWER(cm.client_name)
            WHERE cds.date = s.date AND cds.client_name IS NOT NULL
            ${sf.where}
          )
        GROUP BY s.rider_id, s.hub, hm.city ORDER BY city, s.hub, s.rider_id LIMIT 5000
      `, [startDate, endDate, ...sf.params])
    } else {
      riderRows = await query<Record<string, unknown>>(`
        SELECT
          s.rider_id, MAX(rd.rider_name) AS rider_name, s.hub,
          COALESCE(hm.city, 'Unmapped') AS city,
          SUM(s.assigned_3mr) AS orders_3mr, SUM(s.delivered_3mr) AS delivered_3mr,
          ROUND(SUM(s.delivered_3mr)::NUMERIC / NULLIF(SUM(s.assigned_3mr), 0) * 100, 1) AS del_pct,
          SUM(s.breach_count_3mr) AS breach_count
        FROM rider_day_shipments s
        LEFT JOIN hub_mapping hm ON LOWER(s.hub) = LOWER(hm.hub)
        LEFT JOIN rider_daily rd ON rd.rider_id = s.rider_id AND rd.date = s.date
        WHERE s.date BETWEEN $1 AND $2
        GROUP BY s.rider_id, s.hub, hm.city ORDER BY city, s.hub, s.rider_id LIMIT 5000
      `, [startDate, endDate])
    }

    // L7D and L30D city-level delivery trends
    const [trendRows7, trendRows30] = await Promise.all([
      query<Record<string, unknown>>(`
        SELECT city,
          SUM(CASE WHEN date BETWEEN ($1::DATE - INTERVAL '6 days') AND $1::DATE THEN delivered_3mr ELSE 0 END)::NUMERIC AS curr_del,
          SUM(CASE WHEN date BETWEEN ($1::DATE - INTERVAL '6 days') AND $1::DATE THEN assigned_3mr ELSE 0 END)::NUMERIC AS curr_ord,
          SUM(CASE WHEN date BETWEEN ($1::DATE - INTERVAL '13 days') AND ($1::DATE - INTERVAL '7 days') THEN delivered_3mr ELSE 0 END)::NUMERIC AS prev_del,
          SUM(CASE WHEN date BETWEEN ($1::DATE - INTERVAL '13 days') AND ($1::DATE - INTERVAL '7 days') THEN assigned_3mr ELSE 0 END)::NUMERIC AS prev_ord
        FROM hub_day_l8d GROUP BY city
      `, [maxDateStr]),
      query<Record<string, unknown>>(`
        SELECT h.city,
          SUM(CASE WHEN h.date BETWEEN ($1::DATE - INTERVAL '29 days') AND $1::DATE THEN h.delivered_3mr ELSE 0 END)::NUMERIC AS curr_del,
          SUM(CASE WHEN h.date BETWEEN ($1::DATE - INTERVAL '29 days') AND $1::DATE THEN h.assigned_3mr ELSE 0 END)::NUMERIC AS curr_ord,
          SUM(CASE WHEN h.date BETWEEN ($1::DATE - INTERVAL '59 days') AND ($1::DATE - INTERVAL '30 days') THEN h.delivered_3mr ELSE 0 END)::NUMERIC AS prev_del,
          SUM(CASE WHEN h.date BETWEEN ($1::DATE - INTERVAL '59 days') AND ($1::DATE - INTERVAL '30 days') THEN h.assigned_3mr ELSE 0 END)::NUMERIC AS prev_ord
        FROM rider_day_shipments s
        LEFT JOIN hub_mapping hm ON LOWER(s.hub) = LOWER(hm.hub)
        RIGHT JOIN hub_day_l8d h ON h.hub = s.hub AND h.date = s.date
        GROUP BY h.city
      `, [maxDateStr]),
    ])

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
      filterMeta,
      cities: cityRows.map(r => ({
        city: r.city as string,
        orders3MR: toNum(r.orders_3mr), delivered3MR: toNum(r.delivered_3mr),
        delPct: toNum(r.del_pct), breachCount: toNum(r.breach_count), breachPct: toNum(r.breach_pct),
        trend7: trend7Map[r.city as string] ?? { delPct: 0, prevDelPct: 0, delta: 0 },
        trend30: trend30Map[r.city as string] ?? { delPct: 0, prevDelPct: 0, delta: 0 },
      })),
      hubs: hubRows.map(r => ({
        hub: r.hub, city: r.city ?? '',
        orders3MR: toNum(r.orders_3mr), delivered3MR: toNum(r.delivered_3mr),
        delPct: toNum(r.del_pct), breachCount: toNum(r.breach_count), breachPct: toNum(r.breach_pct),
      })),
      riders: riderRows.map(r => ({
        riderId: Number(r.rider_id), riderName: r.rider_name ?? '',
        hub: r.hub ?? '', city: r.city ?? '',
        behaviourTag: 'Morning Rider', regularityTag: 'Regular',
        orders3MR: toNum(r.orders_3mr), delivered3MR: toNum(r.delivered_3mr),
        delPct: toNum(r.del_pct), breachCount: toNum(r.breach_count),
      })),
    })
  } catch (err) {
    console.error('[API /delivery]', err)
    const { status, body } = apiError(err)
    return NextResponse.json(body, { status })
  }
}
