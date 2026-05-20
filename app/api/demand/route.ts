export const runtime = 'nodejs'
import { NextResponse } from 'next/server'
import { query } from '@/backend/db'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const view = searchParams.get('view') ?? 'city' // 'city' | 'client'
  const primeOnly = searchParams.get('prime') === 'true'

  try {
    const [{ max_date }] = await query('SELECT max_date FROM v_max_date')
    const maxDate = new Date(max_date as string)
    const today = maxDate.toISOString().slice(0, 10)
    const yesterday = new Date(maxDate)
    yesterday.setDate(yesterday.getDate() - 1)
    const d1 = yesterday.toISOString().slice(0, 10)

    // 7-day dates for sparkline
    const sparkDates: string[] = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date(maxDate)
      d.setDate(d.getDate() - i)
      sparkDates.push(d.toISOString().slice(0, 10))
    }

    if (view === 'city') {
      // Today city metrics
      const todayCities = await query(`
        SELECT
          hm.city,
          hm.zone,
          SUM(d.assigned_3mr + d.attempted_3mr) AS total_demand,
          SUM(d.assigned_3mr)                    AS demand_3mr,
          SUM(d.delivered_3mr)                   AS delivered_3mr,
          ROUND(SUM(d.delivered_3mr) * 100.0 / NULLIF(SUM(d.assigned_3mr),0), 1) AS del_pct
        FROM v_3mr_delivery d
        LEFT JOIN hub_mapping hm ON d.hub = hm.hub
        WHERE d.date = '${today}' AND hm.city IS NOT NULL
        GROUP BY hm.city, hm.zone
        ORDER BY demand_3mr DESC
      `)

      // D-1 for trend
      const d1Cities = await query(`
        SELECT hm.city, SUM(d.assigned_3mr) AS demand_3mr
        FROM v_3mr_delivery d
        LEFT JOIN hub_mapping hm ON d.hub = hm.hub
        WHERE d.date = '${d1}' AND hm.city IS NOT NULL
        GROUP BY hm.city
      `)
      const d1Map = Object.fromEntries(d1Cities.map(r => [r.city as string, Number(r.demand_3mr)]))

      // Hub breakdown
      const hubRows = await query(`
        SELECT
          d.hub,
          hm.city,
          SUM(d.assigned_3mr) AS demand_3mr,
          SUM(d.delivered_3mr) AS delivered_3mr,
          ROUND(SUM(d.delivered_3mr) * 100.0 / NULLIF(SUM(d.assigned_3mr),0), 1) AS del_pct
        FROM v_3mr_delivery d
        LEFT JOIN hub_mapping hm ON d.hub = hm.hub
        WHERE d.date = '${today}' AND hm.city IS NOT NULL
        GROUP BY d.hub, hm.city
        ORDER BY hm.city, demand_3mr DESC
      `)

      // Sparklines per city
      const sparkRows = await query(`
        SELECT
          hm.city,
          d.date::VARCHAR AS date,
          SUM(d.assigned_3mr) AS demand_3mr
        FROM v_3mr_delivery d
        LEFT JOIN hub_mapping hm ON d.hub = hm.hub
        WHERE d.date >= '${sparkDates[0]}' AND hm.city IS NOT NULL
        GROUP BY hm.city, d.date
        ORDER BY hm.city, d.date
      `)

      const sparkMap: Record<string, { date: string; value: number }[]> = {}
      for (const r of sparkRows) {
        const city = r.city as string
        if (!sparkMap[city]) sparkMap[city] = []
        sparkMap[city].push({ date: (r.date as string).slice(0, 10), value: Number(r.demand_3mr) })
      }

      const cities = todayCities.map(r => {
        const cityKey = r.city as string
        const prev = d1Map[cityKey] ?? 0
        const curr = Number(r.demand_3mr)
        const diff = prev > 0 ? ((curr - prev) / prev) * 100 : 0
        return {
          city: cityKey,
          zone: r.zone,
          totalDemand: Number(r.total_demand),
          demand3MR: curr,
          delivered3MR: Number(r.delivered_3mr),
          delPct3MR: Number(r.del_pct),
          trendDirection: Math.abs(diff) < 1 ? 'flat' : diff > 0 ? 'up' : 'down',
          trendPct: Math.abs(diff),
          sparkline: sparkMap[cityKey] ?? [],
          hubs: hubRows
            .filter(h => h.city === r.city)
            .map(h => {
              return {
                hub: h.hub,
                demand3MR: Number(h.demand_3mr),
                delPct3MR: Number(h.del_pct),
                trendDirection: 'flat' as const,
                trendPct: 0,
              }
            }),
        }
      })

      return NextResponse.json({ view: 'city', date: today, cities })
    }

    // Client view
    const primeClause = primeOnly ? `AND pc.client_name IS NOT NULL` : ''
    const clientRows = await query(`
      SELECT
        d.client_name,
        CASE WHEN pc.client_name IS NOT NULL THEN TRUE ELSE FALSE END AS is_prime,
        SUM(d.assigned_3mr + d.attempted_3mr) AS total_awbs,
        SUM(d.assigned_3mr)                   AS awbs_3mr,
        SUM(d.delivered_3mr)                  AS delivered,
        ROUND(SUM(d.delivered_3mr) * 100.0 / NULLIF(SUM(d.assigned_3mr),0), 1) AS del_pct
      FROM v_3mr_delivery d
      LEFT JOIN prime_clients pc ON LOWER(TRIM(d.client_name)) = LOWER(TRIM(pc.client_name))
      WHERE d.date = '${today}'
        AND d.client_name IS NOT NULL
        ${primeClause}
      GROUP BY d.client_name, is_prime
      ORDER BY awbs_3mr DESC
      LIMIT 100
    `)

    const d1Clients = await query(`
      SELECT client_name, SUM(assigned_3mr) AS demand_3mr
      FROM v_3mr_delivery
      WHERE date = '${d1}'
      GROUP BY client_name
    `)
    const d1ClientMap = Object.fromEntries(d1Clients.map(r => [r.client_name as string, Number(r.demand_3mr)]))

    const clients = clientRows.map(r => {
      const prev = d1ClientMap[r.client_name as string] ?? 0
      const curr = Number(r.awbs_3mr)
      const diff = prev > 0 ? ((curr - prev) / prev) * 100 : 0
      return {
        clientName: r.client_name,
        isPrime: Boolean(r.is_prime),
        totalAWBs: Number(r.total_awbs),
        awbs3MR: curr,
        delivered: Number(r.delivered),
        delPct: Number(r.del_pct),
        trendDirection: Math.abs(diff) < 1 ? 'flat' : diff > 0 ? 'up' : 'down',
        trendPct: Math.round(Math.abs(diff) * 10) / 10,
      }
    })

    return NextResponse.json({ view: 'client', date: today, clients })
  } catch (err) {
    console.error('[API /demand]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
