export const runtime = 'nodejs'
export const revalidate = 300
import { NextResponse } from 'next/server'
import { query } from '@/backend/db'
import { apiError, parseHour } from '@/lib/validators'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const view = searchParams.get('view') === 'client' ? 'client' : 'city'
  const primeOnly = searchParams.get('prime') === 'true'
  const mr3CutoffHour = parseHour(searchParams.get('mr3CutoffHour'), 15)

  try {
    const [{ max_date }] = await query<{ max_date: string }>('SELECT max_date FROM v_max_date')
    const maxDate = new Date(max_date)
    const today = maxDate.toISOString().slice(0, 10)
    const yesterday = new Date(maxDate); yesterday.setDate(yesterday.getDate() - 1)
    const d1 = yesterday.toISOString().slice(0, 10)

    const sparkDates: string[] = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date(maxDate); d.setDate(d.getDate() - i)
      sparkDates.push(d.toISOString().slice(0, 10))
    }

    if (view === 'city') {
      const prime3mrClause = primeOnly ? 'AND d.is_prime = TRUE' : ''
      const primeAwbClause = primeOnly ? 'AND pc.client_name IS NOT NULL' : ''

      const totalDemandRows = await query<{ city: string; total_demand: number }>(
        `SELECT
          COALESCE(hm.city, 'Unmapped') AS city,
          COUNT(*) AS total_demand
        FROM sdd_awbs a
        LEFT JOIN hub_mapping hm ON LOWER(TRIM(a.hub)) = LOWER(TRIM(hm.hub))
        LEFT JOIN prime_clients pc ON LOWER(TRIM(a.client_name)) = LOWER(TRIM(pc.client_name))
        WHERE a.date = ?
          AND a.ofd_time IS NOT NULL
          ${primeAwbClause}
        GROUP BY COALESCE(hm.city, 'Unmapped')`,
        [today],
      )
      const totalDemandMap = Object.fromEntries(totalDemandRows.map(r => [r.city, Number(r.total_demand)]))

      const todayCities = await query<Record<string, unknown>>(
        `SELECT
          COALESCE(d.city, 'Unmapped') AS city,
          CASE WHEN COALESCE(d.city, 'Unmapped') = 'Zonal' THEN 'Mixed' ELSE COALESCE(MAX(d.zone), 'Unmapped') END AS zone,
          SUM(d.assigned_3mr)                    AS demand_3mr,
          SUM(d.delivered_3mr)                   AS delivered_3mr,
          ROUND(SUM(d.delivered_3mr) * 100.0 / NULLIF(SUM(d.assigned_3mr),0), 1) AS del_pct
        FROM (
          SELECT
            TRY_CAST(ofd_time AS TIMESTAMP)::DATE AS date,
            a.hub,
            a.rider_id,
            a.rider_name,
            a.rider_tag,
            a.client_name,
            hm2.city,
            hm2.zone,
            CASE WHEN pc.client_name IS NOT NULL THEN TRUE ELSE FALSE END AS is_prime,
            COUNT(*) AS assigned_3mr,
            SUM(CASE WHEN a.latest_status IN ('DELIVERED','CID','NOT_CONTACTABLE') THEN 1 ELSE 0 END) AS attempted_3mr,
            SUM(CASE WHEN a.latest_status = 'DELIVERED' THEN 1 ELSE 0 END) AS delivered_3mr,
            SUM(CASE WHEN a.breach THEN 1 ELSE 0 END) AS breach_count
          FROM sdd_awbs a
          LEFT JOIN hub_mapping hm2 ON LOWER(a.hub) = LOWER(hm2.hub)
          LEFT JOIN prime_clients pc ON LOWER(TRIM(a.client_name)) = LOWER(TRIM(pc.client_name))
          WHERE HOUR(a.received_at_hub_time) >= ?
            AND a.ofd_time IS NOT NULL
            AND a.rider_id IS NOT NULL
          GROUP BY TRY_CAST(ofd_time AS TIMESTAMP)::DATE, a.hub, a.rider_id, a.rider_name, a.rider_tag, a.client_name, hm2.city, hm2.zone, is_prime
        ) d
        WHERE d.date = ?
          ${prime3mrClause}
        GROUP BY COALESCE(d.city, 'Unmapped')
        ORDER BY demand_3mr DESC`,
        [mr3CutoffHour, today],
      )

      const d1Cities = await query<{ city: string; demand_3mr: number }>(
        `SELECT COALESCE(d.city, 'Unmapped') AS city, SUM(d.assigned_3mr) AS demand_3mr
           FROM (
             SELECT
               TRY_CAST(ofd_time AS TIMESTAMP)::DATE AS date,
               a.hub,
               a.rider_id,
               a.rider_name,
               a.rider_tag,
               a.client_name,
               hm2.city,
               hm2.zone,
               CASE WHEN pc.client_name IS NOT NULL THEN TRUE ELSE FALSE END AS is_prime,
               COUNT(*) AS assigned_3mr,
               SUM(CASE WHEN a.latest_status IN ('DELIVERED','CID','NOT_CONTACTABLE') THEN 1 ELSE 0 END) AS attempted_3mr,
               SUM(CASE WHEN a.latest_status = 'DELIVERED' THEN 1 ELSE 0 END) AS delivered_3mr,
               SUM(CASE WHEN a.breach THEN 1 ELSE 0 END) AS breach_count
             FROM sdd_awbs a
             LEFT JOIN hub_mapping hm2 ON LOWER(a.hub) = LOWER(hm2.hub)
             LEFT JOIN prime_clients pc ON LOWER(TRIM(a.client_name)) = LOWER(TRIM(pc.client_name))
             WHERE HOUR(a.received_at_hub_time) >= ?
               AND a.ofd_time IS NOT NULL
               AND a.rider_id IS NOT NULL
             GROUP BY TRY_CAST(ofd_time AS TIMESTAMP)::DATE, a.hub, a.rider_id, a.rider_name, a.rider_tag, a.client_name, hm2.city, hm2.zone, is_prime
           ) d
           WHERE d.date = ?
             ${prime3mrClause}
           GROUP BY COALESCE(d.city, 'Unmapped')`,
        [mr3CutoffHour, d1],
      )
      const d1Map = Object.fromEntries(d1Cities.map(r => [r.city, Number(r.demand_3mr)]))

      const hubRows = await query<Record<string, unknown>>(
        `SELECT
          d.hub, COALESCE(d.city, 'Unmapped') AS city,
          COUNT(*) AS row_count,
          SUM(d.assigned_3mr)  AS demand_3mr,
          SUM(d.delivered_3mr) AS delivered_3mr,
          ROUND(SUM(d.delivered_3mr) * 100.0 / NULLIF(SUM(d.assigned_3mr),0), 1) AS del_pct
        FROM (
          SELECT
            TRY_CAST(ofd_time AS TIMESTAMP)::DATE AS date,
            a.hub,
            a.rider_id,
            a.rider_name,
            a.rider_tag,
            a.client_name,
            hm2.city,
            hm2.zone,
            CASE WHEN pc.client_name IS NOT NULL THEN TRUE ELSE FALSE END AS is_prime,
            COUNT(*) AS assigned_3mr,
            SUM(CASE WHEN a.latest_status IN ('DELIVERED','CID','NOT_CONTACTABLE') THEN 1 ELSE 0 END) AS attempted_3mr,
            SUM(CASE WHEN a.latest_status = 'DELIVERED' THEN 1 ELSE 0 END) AS delivered_3mr,
            SUM(CASE WHEN a.breach THEN 1 ELSE 0 END) AS breach_count
          FROM sdd_awbs a
          LEFT JOIN hub_mapping hm2 ON LOWER(a.hub) = LOWER(hm2.hub)
          LEFT JOIN prime_clients pc ON LOWER(TRIM(a.client_name)) = LOWER(TRIM(pc.client_name))
          WHERE HOUR(a.received_at_hub_time) >= ?
            AND a.ofd_time IS NOT NULL
            AND a.rider_id IS NOT NULL
          GROUP BY TRY_CAST(ofd_time AS TIMESTAMP)::DATE, a.hub, a.rider_id, a.rider_name, a.rider_tag, a.client_name, hm2.city, hm2.zone, is_prime
        ) d
        WHERE d.date = ?
          ${prime3mrClause}
        GROUP BY d.hub, COALESCE(d.city, 'Unmapped')
        ORDER BY city, demand_3mr DESC`,
        [mr3CutoffHour, today],
      )

      const hubTotalRows = await query<{ hub: string; city: string; total_demand: number }>(
        `SELECT
          a.hub,
          COALESCE(hm.city, 'Unmapped') AS city,
          COUNT(*) AS total_demand
        FROM sdd_awbs a
        LEFT JOIN hub_mapping hm ON LOWER(TRIM(a.hub)) = LOWER(TRIM(hm.hub))
        LEFT JOIN prime_clients pc ON LOWER(TRIM(a.client_name)) = LOWER(TRIM(pc.client_name))
        WHERE a.date = ?
          AND a.ofd_time IS NOT NULL
          ${primeAwbClause}
        GROUP BY a.hub, COALESCE(hm.city, 'Unmapped')`,
        [today],
      )
      const hubTotalMap = Object.fromEntries(hubTotalRows.map(r => [`${r.city}||${r.hub}`, Number(r.total_demand)]))

      const sparkRows = await query<Record<string, unknown>>(
        `SELECT
          COALESCE(d.city, 'Unmapped') AS city,
          d.date::VARCHAR AS date,
          SUM(d.assigned_3mr) AS demand_3mr
        FROM (
          SELECT
            TRY_CAST(ofd_time AS TIMESTAMP)::DATE AS date,
            a.hub,
            a.rider_id,
            a.rider_name,
            a.rider_tag,
            a.client_name,
            hm2.city,
            hm2.zone,
            CASE WHEN pc.client_name IS NOT NULL THEN TRUE ELSE FALSE END AS is_prime,
            COUNT(*) AS assigned_3mr,
            SUM(CASE WHEN a.latest_status IN ('DELIVERED','CID','NOT_CONTACTABLE') THEN 1 ELSE 0 END) AS attempted_3mr,
            SUM(CASE WHEN a.latest_status = 'DELIVERED' THEN 1 ELSE 0 END) AS delivered_3mr,
            SUM(CASE WHEN a.breach THEN 1 ELSE 0 END) AS breach_count
          FROM sdd_awbs a
          LEFT JOIN hub_mapping hm2 ON LOWER(a.hub) = LOWER(hm2.hub)
          LEFT JOIN prime_clients pc ON LOWER(TRIM(a.client_name)) = LOWER(TRIM(pc.client_name))
          WHERE HOUR(a.received_at_hub_time) >= ?
            AND a.ofd_time IS NOT NULL
            AND a.rider_id IS NOT NULL
          GROUP BY TRY_CAST(ofd_time AS TIMESTAMP)::DATE, a.hub, a.rider_id, a.rider_name, a.rider_tag, a.client_name, hm2.city, hm2.zone, is_prime
        ) d
        WHERE d.date >= ?
          ${prime3mrClause}
        GROUP BY COALESCE(d.city, 'Unmapped'), d.date
        ORDER BY city, d.date`,
        [mr3CutoffHour, sparkDates[0]],
      )

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
          totalDemand: totalDemandMap[cityKey] ?? curr,
          demand3MR: curr,
          delivered3MR: Number(r.delivered_3mr),
          delPct3MR: Number(r.del_pct),
          trendDirection: Math.abs(diff) < 1 ? 'flat' : diff > 0 ? 'up' : 'down',
          trendPct: Math.abs(diff),
          sparkline: sparkMap[cityKey] ?? [],
          hubs: hubRows
            .filter(h => h.city === r.city)
            .map(h => ({
              hub: h.hub,
              totalDemand: hubTotalMap[`${h.city}||${h.hub}`] ?? Number(h.demand_3mr),
              demand3MR: Number(h.demand_3mr),
              delPct3MR: Number(h.del_pct),
              trendDirection: 'flat' as const,
              trendPct: 0,
            })),
        }
      })

      return NextResponse.json({ view: 'city', date: today, cities })
    }

    // Client view
    const primeClause = primeOnly ? 'AND pc.client_name IS NOT NULL' : ''
    const prime3mrClause = primeOnly ? 'AND d.is_prime = TRUE' : ''
    const clientRows = await query<Record<string, unknown>>(
      `WITH total_awbs AS (
        SELECT
          a.client_name,
          COUNT(*) AS total_awbs
        FROM sdd_awbs a
        LEFT JOIN prime_clients pc ON LOWER(TRIM(a.client_name)) = LOWER(TRIM(pc.client_name))
        WHERE a.date = ?
          AND a.ofd_time IS NOT NULL
          AND a.client_name IS NOT NULL
          ${primeClause}
        GROUP BY a.client_name
      )
      SELECT
        d.client_name,
        MAX(CASE WHEN pc.client_name IS NOT NULL THEN TRUE ELSE FALSE END) AS is_prime,
        COALESCE(MAX(t.total_awbs), 0)          AS total_awbs,
        SUM(d.assigned_3mr)                   AS awbs_3mr,
        SUM(d.delivered_3mr)                  AS delivered,
        ROUND(SUM(d.delivered_3mr) * 100.0 / NULLIF(SUM(d.assigned_3mr),0), 1) AS del_pct
      FROM (
        SELECT
          TRY_CAST(ofd_time AS TIMESTAMP)::DATE AS date,
          a.hub,
          a.rider_id,
          a.rider_name,
          a.rider_tag,
          a.client_name,
          hm2.city,
          hm2.zone,
          CASE WHEN pc2.client_name IS NOT NULL THEN TRUE ELSE FALSE END AS is_prime,
          COUNT(*) AS assigned_3mr,
          SUM(CASE WHEN a.latest_status IN ('DELIVERED','CID','NOT_CONTACTABLE') THEN 1 ELSE 0 END) AS attempted_3mr,
          SUM(CASE WHEN a.latest_status = 'DELIVERED' THEN 1 ELSE 0 END) AS delivered_3mr,
          SUM(CASE WHEN a.breach THEN 1 ELSE 0 END) AS breach_count
        FROM sdd_awbs a
        LEFT JOIN hub_mapping hm2 ON LOWER(a.hub) = LOWER(hm2.hub)
        LEFT JOIN prime_clients pc2 ON LOWER(TRIM(a.client_name)) = LOWER(TRIM(pc2.client_name))
        WHERE HOUR(a.received_at_hub_time) >= ?
          AND a.ofd_time IS NOT NULL
          AND a.rider_id IS NOT NULL
        GROUP BY TRY_CAST(ofd_time AS TIMESTAMP)::DATE, a.hub, a.rider_id, a.rider_name, a.rider_tag, a.client_name, hm2.city, hm2.zone, is_prime
      ) d
      LEFT JOIN prime_clients pc ON LOWER(TRIM(d.client_name)) = LOWER(TRIM(pc.client_name))
      LEFT JOIN total_awbs t ON LOWER(TRIM(d.client_name)) = LOWER(TRIM(t.client_name))
      WHERE d.date = ?
        AND d.client_name IS NOT NULL
        ${prime3mrClause}
      GROUP BY d.client_name
      ORDER BY awbs_3mr DESC
      LIMIT 100`,
      [today, mr3CutoffHour, today],
    )

    const d1Clients = await query<{ client_name: string; demand_3mr: number }>(
      `SELECT d.client_name, SUM(d.assigned_3mr) AS demand_3mr
         FROM (
           SELECT
             TRY_CAST(ofd_time AS TIMESTAMP)::DATE AS date,
             a.hub,
             a.rider_id,
             a.rider_name,
             a.rider_tag,
             a.client_name,
             hm2.city,
             hm2.zone,
             CASE WHEN pc.client_name IS NOT NULL THEN TRUE ELSE FALSE END AS is_prime,
             COUNT(*) AS assigned_3mr,
             SUM(CASE WHEN a.latest_status IN ('DELIVERED','CID','NOT_CONTACTABLE') THEN 1 ELSE 0 END) AS attempted_3mr,
             SUM(CASE WHEN a.latest_status = 'DELIVERED' THEN 1 ELSE 0 END) AS delivered_3mr,
             SUM(CASE WHEN a.breach THEN 1 ELSE 0 END) AS breach_count
           FROM sdd_awbs a
           LEFT JOIN hub_mapping hm2 ON LOWER(a.hub) = LOWER(hm2.hub)
           LEFT JOIN prime_clients pc ON LOWER(TRIM(a.client_name)) = LOWER(TRIM(pc.client_name))
           WHERE HOUR(a.received_at_hub_time) >= ?
             AND a.ofd_time IS NOT NULL
             AND a.rider_id IS NOT NULL
           GROUP BY TRY_CAST(ofd_time AS TIMESTAMP)::DATE, a.hub, a.rider_id, a.rider_name, a.rider_tag, a.client_name, hm2.city, hm2.zone, is_prime
         ) d
         WHERE date = ?
           ${prime3mrClause}
         GROUP BY d.client_name`,
      [mr3CutoffHour, d1],
    )
    const d1ClientMap = Object.fromEntries(d1Clients.map(r => [r.client_name, Number(r.demand_3mr)]))

    // L7D avg for clients — average daily awbs_3mr over last 7 days
    const clientL7dRows = await query<{ client_name: string; avg_3mr: number }>(
      `SELECT client_name, ROUND(AVG(daily_3mr), 0) AS avg_3mr
       FROM (
         SELECT client_name, date, SUM(assigned_3mr) AS daily_3mr
         FROM (
           SELECT
             TRY_CAST(ofd_time AS TIMESTAMP)::DATE AS date,
             a.hub,
             a.rider_id,
             a.rider_name,
             a.rider_tag,
             a.client_name,
             hm2.city,
             hm2.zone,
             CASE WHEN pc.client_name IS NOT NULL THEN TRUE ELSE FALSE END AS is_prime,
             COUNT(*) AS assigned_3mr,
             SUM(CASE WHEN a.latest_status IN ('DELIVERED','CID','NOT_CONTACTABLE') THEN 1 ELSE 0 END) AS attempted_3mr,
             SUM(CASE WHEN a.latest_status = 'DELIVERED' THEN 1 ELSE 0 END) AS delivered_3mr,
             SUM(CASE WHEN a.breach THEN 1 ELSE 0 END) AS breach_count
           FROM sdd_awbs a
           LEFT JOIN hub_mapping hm2 ON LOWER(a.hub) = LOWER(hm2.hub)
           LEFT JOIN prime_clients pc ON LOWER(TRIM(a.client_name)) = LOWER(TRIM(pc.client_name))
           WHERE HOUR(a.received_at_hub_time) >= ?
             AND a.ofd_time IS NOT NULL
             AND a.rider_id IS NOT NULL
           GROUP BY TRY_CAST(ofd_time AS TIMESTAMP)::DATE, a.hub, a.rider_id, a.rider_name, a.rider_tag, a.client_name, hm2.city, hm2.zone, is_prime
         ) d
         WHERE date BETWEEN (CAST(? AS DATE) - INTERVAL 6 DAY) AND CAST(? AS DATE)
           ${prime3mrClause}
         GROUP BY client_name, date
       )
       GROUP BY client_name`,
      [mr3CutoffHour, today, today],
    )
    const clientL7dMap = Object.fromEntries(clientL7dRows.map(r => [r.client_name, Number(r.avg_3mr)]))

    // Sparkline for top clients — 7 days of daily awbs_3mr
    const clientSparkRows = await query<{ client_name: string; date: string; daily_3mr: number }>(
      `SELECT client_name, date::VARCHAR AS date, SUM(assigned_3mr) AS daily_3mr
       FROM (
         SELECT
           TRY_CAST(ofd_time AS TIMESTAMP)::DATE AS date,
           a.hub,
           a.rider_id,
           a.rider_name,
           a.rider_tag,
           a.client_name,
           hm2.city,
           hm2.zone,
           CASE WHEN pc.client_name IS NOT NULL THEN TRUE ELSE FALSE END AS is_prime,
           COUNT(*) AS assigned_3mr,
           SUM(CASE WHEN a.latest_status IN ('DELIVERED','CID','NOT_CONTACTABLE') THEN 1 ELSE 0 END) AS attempted_3mr,
           SUM(CASE WHEN a.latest_status = 'DELIVERED' THEN 1 ELSE 0 END) AS delivered_3mr,
           SUM(CASE WHEN a.breach THEN 1 ELSE 0 END) AS breach_count
         FROM sdd_awbs a
         LEFT JOIN hub_mapping hm2 ON LOWER(a.hub) = LOWER(hm2.hub)
         LEFT JOIN prime_clients pc ON LOWER(TRIM(a.client_name)) = LOWER(TRIM(pc.client_name))
         WHERE HOUR(a.received_at_hub_time) >= ?
           AND a.ofd_time IS NOT NULL
           AND a.rider_id IS NOT NULL
         GROUP BY TRY_CAST(ofd_time AS TIMESTAMP)::DATE, a.hub, a.rider_id, a.rider_name, a.rider_tag, a.client_name, hm2.city, hm2.zone, is_prime
       ) d
       WHERE date BETWEEN (CAST(? AS DATE) - INTERVAL 6 DAY) AND CAST(? AS DATE)
         ${prime3mrClause}
         AND client_name IN (
           SELECT client_name
           FROM (
             SELECT
               TRY_CAST(ofd_time AS TIMESTAMP)::DATE AS date,
               a.hub,
               a.rider_id,
               a.rider_name,
               a.rider_tag,
               a.client_name,
               hm2.city,
               hm2.zone,
               CASE WHEN pc.client_name IS NOT NULL THEN TRUE ELSE FALSE END AS is_prime,
               COUNT(*) AS assigned_3mr,
               SUM(CASE WHEN a.latest_status IN ('DELIVERED','CID','NOT_CONTACTABLE') THEN 1 ELSE 0 END) AS attempted_3mr,
               SUM(CASE WHEN a.latest_status = 'DELIVERED' THEN 1 ELSE 0 END) AS delivered_3mr,
               SUM(CASE WHEN a.breach THEN 1 ELSE 0 END) AS breach_count
             FROM sdd_awbs a
             LEFT JOIN hub_mapping hm2 ON LOWER(a.hub) = LOWER(hm2.hub)
             LEFT JOIN prime_clients pc ON LOWER(TRIM(a.client_name)) = LOWER(TRIM(pc.client_name))
             WHERE HOUR(a.received_at_hub_time) >= ?
               AND a.ofd_time IS NOT NULL
               AND a.rider_id IS NOT NULL
             GROUP BY TRY_CAST(ofd_time AS TIMESTAMP)::DATE, a.hub, a.rider_id, a.rider_name, a.rider_tag, a.client_name, hm2.city, hm2.zone, is_prime
           ) d
           WHERE date = ?
             ${prime3mrClause}
           GROUP BY client_name
           ORDER BY SUM(assigned_3mr) DESC
           LIMIT 100
         )
       GROUP BY client_name, date
       ORDER BY client_name, date`,
      [mr3CutoffHour, today, today, mr3CutoffHour, today],
    )
    const clientSparkMap: Record<string, { date: string; value: number }[]> = {}
    for (const r of clientSparkRows) {
      const key = r.client_name as string
      if (!clientSparkMap[key]) clientSparkMap[key] = []
      clientSparkMap[key].push({ date: (r.date as string).slice(0, 10), value: Number(r.daily_3mr) })
    }

    const clients = clientRows.map(r => {
      const name = r.client_name as string
      const prev = d1ClientMap[name] ?? 0
      const curr = Number(r.awbs_3mr)
      const diff = prev > 0 ? ((curr - prev) / prev) * 100 : 0
      return {
        clientName: name,
        isPrime: Boolean(r.is_prime),
        totalAWBs: Number(r.total_awbs),
        awbs3MR: curr,
        delivered: Number(r.delivered),
        delPct: Number(r.del_pct),
        trendDirection: Math.abs(diff) < 1 ? 'flat' : diff > 0 ? 'up' : 'down',
        trendPct: Math.round(Math.abs(diff) * 10) / 10,
        avgL7d: clientL7dMap[name] ?? 0,
        sparkline: clientSparkMap[name] ?? [],
      }
    })

    return NextResponse.json({ view: 'client', date: today, clients })
  } catch (err) {
    console.error('[API /demand]', err)
    const { status, body } = apiError(err)
    return NextResponse.json(body, { status })
  }
}
