export const runtime = 'nodejs'
export const revalidate = 300
import { NextResponse } from 'next/server'
import { query } from '@/lib/supabase/sql'
import { apiError } from '@/lib/validators'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const view = searchParams.get('view') === 'client' ? 'client' : 'city'
  const primeOnly = searchParams.get('prime') === 'true'
  const clientFilter = searchParams.get('client')
  const hasClientFilter = clientFilter && clientFilter !== 'all' && clientFilter !== ''

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

    // Client list for dropdown
    const clientNamesRows = await query<{ client_name: string }>(
      `SELECT DISTINCT client_name FROM client_day_shipments
       WHERE date >= $1::DATE - INTERVAL '7 days'
         AND client_name IS NOT NULL
       ORDER BY client_name`,
      [today]
    )
    const clientNames = clientNamesRows.map(r => r.client_name)

    if (view === 'city') {
      // Today city-level 3MR and total from hub_day_l8d
      const todayCities = await query<Record<string, unknown>>(`
        SELECT
          h.city,
          MAX(h.zone) AS zone,
          SUM(h.assigned_3mr)   AS demand_3mr,
          SUM(h.delivered_3mr)  AS delivered_3mr,
          SUM(h.assigned_overall) AS total_demand,
          ROUND(SUM(h.delivered_3mr)::NUMERIC / NULLIF(SUM(h.assigned_3mr), 0) * 100, 1) AS del_pct
        FROM hub_day_l8d h
        WHERE h.date = $1
        GROUP BY h.city
        ORDER BY demand_3mr DESC
      `, [today])

      // D-1 city demand for trend
      const d1Cities = await query<{ city: string; demand_3mr: number }>(`
        SELECT city, SUM(assigned_3mr) AS demand_3mr
        FROM hub_day_l8d
        WHERE date = $1
        GROUP BY city
      `, [d1])
      const d1Map = Object.fromEntries(d1Cities.map(r => [r.city, Number(r.demand_3mr)]))

      // Hub breakdown for today
      const hubRows = await query<Record<string, unknown>>(`
        SELECT
          h.hub, h.city,
          SUM(h.assigned_3mr)   AS demand_3mr,
          SUM(h.delivered_3mr)  AS delivered_3mr,
          SUM(h.assigned_overall) AS total_demand,
          ROUND(SUM(h.delivered_3mr)::NUMERIC / NULLIF(SUM(h.assigned_3mr), 0) * 100, 1) AS del_pct
        FROM hub_day_l8d h
        WHERE h.date = $1
        GROUP BY h.hub, h.city
        ORDER BY h.city, demand_3mr DESC
      `, [today])

      // 7-day sparkline per city
      const sparkRows = await query<{ city: string; date: string; demand_3mr: number }>(`
        SELECT city, date::TEXT AS date, SUM(assigned_3mr) AS demand_3mr
        FROM hub_day_l8d
        WHERE date BETWEEN $1 AND $2
        GROUP BY city, date
        ORDER BY city, date
      `, [sparkStartStr, today])
      const sparkMap: Record<string, { date: string; value: number }[]> = {}
      for (const r of sparkRows) {
        if (!sparkMap[r.city]) sparkMap[r.city] = []
        sparkMap[r.city].push({ date: r.date, value: Number(r.demand_3mr) })
      }

      const toNum = (v: unknown) => v == null ? 0 : Number(v)
      const cities = todayCities.map(r => {
        const cityKey = r.city as string
        const prev = d1Map[cityKey] ?? 0
        const curr = toNum(r.demand_3mr)
        const diff = prev > 0 ? ((curr - prev) / prev) * 100 : 0
        return {
          city: cityKey,
          zone: r.zone ?? 'Unmapped',
          totalDemand: toNum(r.total_demand),
          demand3MR: curr,
          delivered3MR: toNum(r.delivered_3mr),
          delPct3MR: toNum(r.del_pct),
          trendDirection: Math.abs(diff) < 1 ? 'flat' : diff > 0 ? 'up' : 'down',
          trendPct: Math.round(Math.abs(diff) * 10) / 10,
          sparkline: sparkMap[cityKey] ?? [],
          hubs: hubRows
            .filter(h => h.city === r.city)
            .map(h => ({
              hub: h.hub,
              totalDemand: toNum(h.total_demand),
              demand3MR: toNum(h.demand_3mr),
              delPct3MR: toNum(h.del_pct),
              trendDirection: 'flat' as const,
              trendPct: 0,
            })),
        }
      })

      return NextResponse.json({ view: 'city', date: today, cities, clientList: clientNames })
    }

    // Client view
    const primeFilter = primeOnly ? 'AND is_prime = TRUE' : ''
    const clientWhereClause = hasClientFilter ? 'AND LOWER(client_name) = LOWER($2)' : ''
    const clientParams: unknown[] = [today]
    if (hasClientFilter) clientParams.push(clientFilter)

    const clientRows = await query<Record<string, unknown>>(`
      SELECT
        client_name,
        is_prime,
        SUM(awbs_3mr)      AS awbs_3mr,
        SUM(delivered_3mr) AS delivered,
        SUM(awbs_overall)  AS total_awbs,
        ROUND(SUM(delivered_3mr)::NUMERIC / NULLIF(SUM(awbs_3mr), 0) * 100, 1) AS del_pct
      FROM client_day_shipments
      WHERE date = $1
        AND client_name IS NOT NULL
        ${primeFilter}
        ${clientWhereClause}
      GROUP BY client_name, is_prime
      ORDER BY awbs_3mr DESC
      LIMIT 100
    `, clientParams)

    const d1ClientParams: unknown[] = [d1]
    if (hasClientFilter) d1ClientParams.push(clientFilter)
    const d1Clients = await query<{ client_name: string; demand_3mr: number }>(`
      SELECT client_name, SUM(awbs_3mr) AS demand_3mr
      FROM client_day_shipments
      WHERE date = $1
        AND client_name IS NOT NULL
        ${primeFilter}
        ${clientWhereClause}
      GROUP BY client_name
    `, d1ClientParams)
    const d1ClientMap = Object.fromEntries(d1Clients.map(r => [r.client_name, Number(r.demand_3mr)]))

    // L7D avg per client
    const l7dParams: unknown[] = [sparkStartStr, today]
    if (hasClientFilter) l7dParams.push(clientFilter)
    const clientL7dRows = await query<{ client_name: string; avg_3mr: number }>(`
      SELECT client_name, ROUND(AVG(daily_3mr), 0) AS avg_3mr
      FROM (
        SELECT client_name, date, SUM(awbs_3mr) AS daily_3mr
        FROM client_day_shipments
        WHERE date BETWEEN $1 AND $2
          AND client_name IS NOT NULL
          ${primeFilter}
          ${hasClientFilter ? 'AND LOWER(client_name) = LOWER($3)' : ''}
        GROUP BY client_name, date
      ) sub
      GROUP BY client_name
    `, l7dParams)
    const clientL7dMap = Object.fromEntries(clientL7dRows.map(r => [r.client_name, Number(r.avg_3mr)]))

    // Sparkline per client (same 7 day window)
    const sparkParams: unknown[] = [sparkStartStr, today]
    if (hasClientFilter) sparkParams.push(clientFilter)
    const clientSparkRows = await query<{ client_name: string; date: string; daily_3mr: number }>(`
      SELECT client_name, date::TEXT AS date, SUM(awbs_3mr) AS daily_3mr
      FROM client_day_shipments
      WHERE date BETWEEN $1 AND $2
        AND client_name IS NOT NULL
        ${primeFilter}
        ${hasClientFilter ? 'AND LOWER(client_name) = LOWER($3)' : ''}
      GROUP BY client_name, date
      ORDER BY client_name, date
    `, sparkParams)
    const clientSparkMap: Record<string, { date: string; value: number }[]> = {}
    for (const r of clientSparkRows) {
      if (!clientSparkMap[r.client_name]) clientSparkMap[r.client_name] = []
      clientSparkMap[r.client_name].push({ date: r.date, value: Number(r.daily_3mr) })
    }

    const toNum = (v: unknown) => v == null ? 0 : Number(v)
    const clients = clientRows.map(r => {
      const name = r.client_name as string
      const prev = d1ClientMap[name] ?? 0
      const curr = toNum(r.awbs_3mr)
      const diff = prev > 0 ? ((curr - prev) / prev) * 100 : 0
      return {
        clientName: name,
        isPrime: Boolean(r.is_prime),
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

    return NextResponse.json({ view: 'client', date: today, clients, clientList: clientNames })
  } catch (err) {
    console.error('[API /demand]', err)
    const { status, body } = apiError(err)
    return NextResponse.json(body, { status })
  }
}
