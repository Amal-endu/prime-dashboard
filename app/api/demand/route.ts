export const runtime = 'nodejs'
export const revalidate = 300
import { NextResponse } from 'next/server'
import { query } from '@/lib/supabase/sql'
import { apiError } from '@/lib/validators'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const view = searchParams.get('view') === 'client' ? 'client' : 'city'

  const clientTypeFilter   = searchParams.get('clientType')   ?? ''
  const clientBucketFilter = searchParams.get('clientBucket') ?? ''
  const criticalOnly       = searchParams.get('critical') === 'true'
  const clientFilter       = searchParams.get('client') ?? ''
  const hasClientFilter    = !!(clientFilter && clientFilter !== 'all')
  // Allocation mode: same_day_received uses assigned_sdd, all_ofd uses assigned_overall
  const allocationMode     = searchParams.get('allocationMode') === 'all_ofd' ? 'all_ofd' : 'same_day_received'
  const totalDemandCol     = allocationMode === 'same_day_received' ? 'assigned_sdd' : 'assigned_overall'

  const needsMapping = criticalOnly || !!clientTypeFilter || !!clientBucketFilter
  const cmJoin = needsMapping
    ? `LEFT JOIN client_mapping cm ON LOWER(cds.client_name) = LOWER(cm.client_name)`
    : ''

  // Build a segment WHERE fragment starting at $startIdx (1-based).
  // Returns { clauses: string[], params: unknown[] } — caller prepends fixed params.
  function segFilter(startIdx: number) {
    const clauses: string[] = []
    const params: unknown[] = []
    let i = startIdx
    if (criticalOnly)      clauses.push(`cm.critical_client = TRUE`)
    if (clientTypeFilter)  { clauses.push(`cm.client_type = $${i++}`);   params.push(clientTypeFilter) }
    if (clientBucketFilter){ clauses.push(`cm.client_bucket = $${i++}`); params.push(clientBucketFilter) }
    if (hasClientFilter)   { clauses.push(`LOWER(cds.client_name) = LOWER($${i++})`); params.push(clientFilter) }
    return { where: clauses.length ? 'AND ' + clauses.join(' AND ') : '', params }
  }

  try {
    const [anchor] = await query<{ anchor_date: string }>(
      'SELECT anchor_date::TEXT AS anchor_date FROM data_anchor WHERE id = 1'
    )
    const maxDate = new Date(anchor.anchor_date)
    const today = anchor.anchor_date
    const yesterday = new Date(maxDate)
    yesterday.setDate(yesterday.getDate() - 1)
    const d1 = yesterday.toISOString().slice(0, 10)
    const sparkStart = new Date(maxDate)
    sparkStart.setDate(sparkStart.getDate() - 6)
    const sparkStartStr = sparkStart.toISOString().slice(0, 10)

    const [clientTypesRes, clientBucketsRes, criticalCountRes, clientNamesRows] = await Promise.all([
      query<{ client_type: string }>('SELECT DISTINCT client_type FROM client_mapping WHERE client_type IS NOT NULL ORDER BY client_type'),
      query<{ client_bucket: string }>('SELECT DISTINCT client_bucket FROM client_mapping WHERE client_bucket IS NOT NULL ORDER BY client_bucket'),
      query<{ n: number }>('SELECT COUNT(*)::INT AS n FROM client_mapping WHERE critical_client = TRUE'),
      query<{ client_name: string }>(
        `SELECT DISTINCT client_name FROM client_day_shipments
         WHERE date >= $1::DATE - INTERVAL '7 days' AND client_name IS NOT NULL
         ORDER BY client_name`,
        [today]
      ),
    ])
    const filterMeta = {
      clientTypes:   clientTypesRes.map(r => r.client_type),
      clientBuckets: clientBucketsRes.map(r => r.client_bucket),
      criticalCount: criticalCountRes[0]?.n ?? 0,
    }
    const clientNames = clientNamesRows.map(r => r.client_name)
    const toNum = (v: unknown) => v == null ? 0 : Number(v)

    // ── City view — pre-aggregated, no client breakdown ───────────────────────────
    if (view === 'city') {
      const [todayCities, d1Cities, hubRows, sparkRows] = await Promise.all([
        query<Record<string, unknown>>(`
          SELECT h.city, MAX(h.zone) AS zone,
            SUM(h.assigned_3mr) AS demand_3mr, SUM(h.delivered_3mr) AS delivered_3mr,
            SUM(h.${totalDemandCol}) AS total_demand,
            ROUND(SUM(h.delivered_3mr)::NUMERIC / NULLIF(SUM(h.assigned_3mr), 0) * 100, 1) AS del_pct
          FROM hub_day_l8d h WHERE h.date = $1
          GROUP BY h.city ORDER BY demand_3mr DESC
        `, [today]),
        query<{ city: string; demand_3mr: number }>(`
          SELECT city, SUM(assigned_3mr) AS demand_3mr FROM hub_day_l8d WHERE date = $1 GROUP BY city
        `, [d1]),
        query<Record<string, unknown>>(`
          SELECT h.hub, h.city,
            SUM(h.assigned_3mr) AS demand_3mr, SUM(h.delivered_3mr) AS delivered_3mr,
            SUM(h.${totalDemandCol}) AS total_demand,
            ROUND(SUM(h.delivered_3mr)::NUMERIC / NULLIF(SUM(h.assigned_3mr), 0) * 100, 1) AS del_pct
          FROM hub_day_l8d h WHERE h.date = $1
          GROUP BY h.hub, h.city ORDER BY h.city, demand_3mr DESC
        `, [today]),
        query<{ city: string; date: string; demand_3mr: number }>(`
          SELECT city, date::TEXT AS date, SUM(assigned_3mr) AS demand_3mr
          FROM hub_day_l8d WHERE date BETWEEN $1 AND $2
          GROUP BY city, date ORDER BY city, date
        `, [sparkStartStr, today]),
      ])

      const d1Map = Object.fromEntries(d1Cities.map(r => [r.city, Number(r.demand_3mr)]))
      const sparkMap: Record<string, { date: string; value: number }[]> = {}
      for (const r of sparkRows) {
        if (!sparkMap[r.city]) sparkMap[r.city] = []
        sparkMap[r.city].push({ date: r.date, value: Number(r.demand_3mr) })
      }
      const cities = todayCities.map(r => {
        const cityKey = r.city as string
        const prev = d1Map[cityKey] ?? 0
        const curr = toNum(r.demand_3mr)
        const diff = prev > 0 ? ((curr - prev) / prev) * 100 : 0
        return {
          city: cityKey, zone: r.zone ?? 'Unmapped',
          totalDemand: toNum(r.total_demand), demand3MR: curr,
          delivered3MR: toNum(r.delivered_3mr), delPct3MR: toNum(r.del_pct),
          trendDirection: Math.abs(diff) < 1 ? 'flat' : diff > 0 ? 'up' : 'down',
          trendPct: Math.round(Math.abs(diff) * 10) / 10,
          sparkline: sparkMap[cityKey] ?? [],
          hubs: hubRows.filter(h => h.city === r.city).map(h => ({
            hub: h.hub, totalDemand: toNum(h.total_demand),
            demand3MR: toNum(h.demand_3mr), delPct3MR: toNum(h.del_pct),
            trendDirection: 'flat' as const, trendPct: 0,
          })),
        }
      })
      return NextResponse.json({ view: 'city', date: today, cities, clientList: clientNames, filterMeta })
    }

    // ── Client view — segment filters applied via client_mapping JOIN ─────────────
    // Each query has different fixed params before the segment extras:
    //   today-query:  $1=today        → seg starts at $2
    //   d1-query:     $1=d1           → seg starts at $2
    //   spark-query:  $1=start $2=end → seg starts at $3
    const sf1 = segFilter(2)  // 1 fixed param before seg
    const sf2 = segFilter(3)  // 2 fixed params before seg (spark/l7d)

    const [clientRows, d1Clients, clientL7dRows, clientSparkRows] = await Promise.all([
      query<Record<string, unknown>>(`
        SELECT cds.client_name, cds.is_prime,
          cm.client_type, cm.client_bucket, COALESCE(cm.critical_client, FALSE) AS critical_client,
          SUM(cds.awbs_3mr) AS awbs_3mr, SUM(cds.delivered_3mr) AS delivered,
          SUM(cds.awbs_overall) AS total_awbs,
          ROUND(SUM(cds.delivered_3mr)::NUMERIC / NULLIF(SUM(cds.awbs_3mr), 0) * 100, 1) AS del_pct
        FROM client_day_shipments cds ${cmJoin}
        WHERE cds.date = $1 AND cds.client_name IS NOT NULL ${sf1.where}
        GROUP BY cds.client_name, cds.is_prime, cm.client_type, cm.client_bucket, cm.critical_client
        ORDER BY awbs_3mr DESC LIMIT 200
      `, [today, ...sf1.params]),
      query<{ client_name: string; demand_3mr: number }>(`
        SELECT cds.client_name, SUM(cds.awbs_3mr) AS demand_3mr
        FROM client_day_shipments cds ${cmJoin}
        WHERE cds.date = $1 AND cds.client_name IS NOT NULL ${sf1.where}
        GROUP BY cds.client_name
      `, [d1, ...sf1.params]),
      query<{ client_name: string; avg_3mr: number }>(`
        SELECT client_name, ROUND(AVG(daily_3mr), 0) AS avg_3mr
        FROM (
          SELECT cds.client_name, cds.date, SUM(cds.awbs_3mr) AS daily_3mr
          FROM client_day_shipments cds ${cmJoin}
          WHERE cds.date BETWEEN $1 AND $2 AND cds.client_name IS NOT NULL ${sf2.where}
          GROUP BY cds.client_name, cds.date
        ) sub GROUP BY client_name
      `, [sparkStartStr, today, ...sf2.params]),
      query<{ client_name: string; date: string; daily_3mr: number }>(`
        SELECT cds.client_name, cds.date::TEXT AS date, SUM(cds.awbs_3mr) AS daily_3mr
        FROM client_day_shipments cds ${cmJoin}
        WHERE cds.date BETWEEN $1 AND $2 AND cds.client_name IS NOT NULL ${sf2.where}
        GROUP BY cds.client_name, cds.date ORDER BY cds.client_name, cds.date
      `, [sparkStartStr, today, ...sf2.params]),
    ])

    const d1ClientMap = Object.fromEntries(d1Clients.map(r => [r.client_name, Number(r.demand_3mr)]))
    const clientL7dMap = Object.fromEntries(clientL7dRows.map(r => [r.client_name, Number(r.avg_3mr)]))
    const clientSparkMap: Record<string, { date: string; value: number }[]> = {}
    for (const r of clientSparkRows) {
      if (!clientSparkMap[r.client_name]) clientSparkMap[r.client_name] = []
      clientSparkMap[r.client_name].push({ date: r.date, value: Number(r.daily_3mr) })
    }

    const clients = clientRows.map(r => {
      const name = r.client_name as string
      const prev = d1ClientMap[name] ?? 0
      const curr = toNum(r.awbs_3mr)
      const diff = prev > 0 ? ((curr - prev) / prev) * 100 : 0
      return {
        clientName: name,
        isPrime: Boolean(r.is_prime),
        clientType: (r.client_type as string | null) ?? null,
        clientBucket: (r.client_bucket as string | null) ?? null,
        isCritical: Boolean(r.critical_client),
        totalAWBs: toNum(r.total_awbs),
        awbs3MR: curr,
        delivered: toNum(r.delivered),
        delPct: toNum(r.del_pct),
        trendDirection: Math.abs(diff) < 1 ? 'flat' : diff > 0 ? 'up' : 'down',
        trendPct: Math.round(Math.abs(diff) * 10) / 10,
        avgL7d: clientL7dMap[name] ?? 0,
        sparkline: clientSparkMap[name] ?? [],
      }
    })
    return NextResponse.json({ view: 'client', date: today, clients, clientList: clientNames, filterMeta })
  } catch (err) {
    console.error('[API /demand]', err)
    const { status, body } = apiError(err)
    return NextResponse.json(body, { status })
  }
}
