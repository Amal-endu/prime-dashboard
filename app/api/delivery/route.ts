export const runtime = 'nodejs'
import { NextResponse } from 'next/server'
import { query } from '@/backend/db'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const behaviour = searchParams.get('behaviour')
  const regularity = searchParams.get('regularity')
  const primeOnly = searchParams.get('prime') === 'true'
  const datePreset = searchParams.get('date') ?? 'today' // today | d1..d7 | l7d | l30d

  try {
    const [{ max_date }] = await query('SELECT max_date FROM v_max_date')
    const maxDate = new Date(max_date as string)
    const maxDateStr = maxDate.toISOString().slice(0, 10)

    // Resolve start/end from preset
    let startDate: string
    let endDate: string = maxDateStr

    if (datePreset === 'l7d') {
      const d = new Date(maxDate); d.setDate(d.getDate() - 6)
      startDate = d.toISOString().slice(0, 10)
    } else if (datePreset === 'l30d') {
      const d = new Date(maxDate); d.setDate(d.getDate() - 29)
      startDate = d.toISOString().slice(0, 10)
    } else if (datePreset.startsWith('d')) {
      const n = parseInt(datePreset.slice(1), 10) // d1 -> 1, d7 -> 7
      const d = new Date(maxDate); d.setDate(d.getDate() - n)
      startDate = endDate = d.toISOString().slice(0, 10)
    } else {
      // today
      startDate = endDate = maxDateStr
    }

    const behaviourClause = behaviour ? `AND rs.login_behaviour_tag = '${behaviour.replace(/'/g, "''")}'` : ''
    const regularityClause = regularity ? `AND rs.regularity_tag = '${regularity.replace(/'/g, "''")}'` : ''
    const primeClause = primeOnly ? `AND d.is_prime = TRUE` : ''

    // Rider rows
    const riderRows = await query(`
      WITH rs_map AS (
        SELECT DISTINCT ON (rider_id)
          rider_id, login_behaviour_tag, regularity_tag
        FROM v_rider_summary
      )
      SELECT
        d.rider_id,
        MAX(d.rider_name)                                                    AS rider_name,
        d.hub,
        MAX(d.city)                                                          AS city,
        MAX(rs.login_behaviour_tag)                                          AS behaviour_tag,
        MAX(rs.regularity_tag)                                               AS regularity_tag,
        SUM(d.assigned_3mr)                                                  AS orders_3mr,
        SUM(d.delivered_3mr)                                                 AS delivered_3mr,
        ROUND(SUM(d.delivered_3mr) * 100.0 / NULLIF(SUM(d.assigned_3mr),0), 1) AS del_pct,
        SUM(d.breach_count)                                                  AS breach_count
      FROM v_3mr_delivery d
      LEFT JOIN rs_map rs ON d.rider_id = rs.rider_id
      WHERE d.date BETWEEN '${startDate}' AND '${endDate}'
        ${behaviourClause} ${regularityClause} ${primeClause}
      GROUP BY d.rider_id, d.hub
      ORDER BY del_pct ASC NULLS LAST
      LIMIT 5000
    `)

    // Hub rollup
    const hubRows = await query(`
      WITH rs_map AS (
        SELECT DISTINCT ON (rider_id) rider_id, login_behaviour_tag, regularity_tag
        FROM v_rider_summary
      )
      SELECT
        d.hub,
        MAX(d.city)                                                             AS city,
        SUM(d.assigned_3mr)                                                     AS orders_3mr,
        SUM(d.delivered_3mr)                                                    AS delivered_3mr,
        ROUND(SUM(d.delivered_3mr) * 100.0 / NULLIF(SUM(d.assigned_3mr),0), 1) AS del_pct,
        SUM(d.breach_count)                                                     AS breach_count,
        ROUND(SUM(d.breach_count)  * 100.0 / NULLIF(SUM(d.assigned_3mr),0), 1) AS breach_pct
      FROM v_3mr_delivery d
      LEFT JOIN rs_map rs ON d.rider_id = rs.rider_id
      WHERE d.date BETWEEN '${startDate}' AND '${endDate}'
        ${behaviourClause} ${regularityClause} ${primeClause}
      GROUP BY d.hub
      ORDER BY city, del_pct ASC NULLS LAST
    `)

    // City rollup
    const cityRows = await query(`
      WITH rs_map AS (
        SELECT DISTINCT ON (rider_id) rider_id, login_behaviour_tag, regularity_tag
        FROM v_rider_summary
      )
      SELECT
        hm.city,
        SUM(d.assigned_3mr)                                                     AS orders_3mr,
        SUM(d.delivered_3mr)                                                    AS delivered_3mr,
        ROUND(SUM(d.delivered_3mr) * 100.0 / NULLIF(SUM(d.assigned_3mr),0), 1) AS del_pct,
        SUM(d.breach_count)                                                     AS breach_count,
        ROUND(SUM(d.breach_count)  * 100.0 / NULLIF(SUM(d.assigned_3mr),0), 1) AS breach_pct
      FROM v_3mr_delivery d
      LEFT JOIN hub_mapping hm ON d.hub = hm.hub
      LEFT JOIN rs_map rs ON d.rider_id = rs.rider_id
      WHERE d.date BETWEEN '${startDate}' AND '${endDate}'
        AND hm.city IS NOT NULL
        ${behaviourClause} ${regularityClause} ${primeClause}
      GROUP BY hm.city
      ORDER BY del_pct ASC NULLS LAST
    `)

    // L7D trend: compare last 7 days DEL% vs previous 7 days DEL%
    const trendRows7 = await query(`
      SELECT
        hm.city,
        SUM(CASE WHEN d.date BETWEEN (DATE '${maxDateStr}' - INTERVAL 6 DAY) AND DATE '${maxDateStr}'
            THEN d.delivered_3mr ELSE 0 END)::DOUBLE AS curr_del,
        SUM(CASE WHEN d.date BETWEEN (DATE '${maxDateStr}' - INTERVAL 6 DAY) AND DATE '${maxDateStr}'
            THEN d.assigned_3mr ELSE 0 END)::DOUBLE AS curr_ord,
        SUM(CASE WHEN d.date BETWEEN (DATE '${maxDateStr}' - INTERVAL 13 DAY) AND (DATE '${maxDateStr}' - INTERVAL 7 DAY)
            THEN d.delivered_3mr ELSE 0 END)::DOUBLE AS prev_del,
        SUM(CASE WHEN d.date BETWEEN (DATE '${maxDateStr}' - INTERVAL 13 DAY) AND (DATE '${maxDateStr}' - INTERVAL 7 DAY)
            THEN d.assigned_3mr ELSE 0 END)::DOUBLE AS prev_ord
      FROM v_3mr_delivery d
      LEFT JOIN hub_mapping hm ON d.hub = hm.hub
      WHERE hm.city IS NOT NULL
      GROUP BY hm.city
    `)

    // L30D trend: compare last 30 days DEL% vs previous 30 days DEL%
    const trendRows30 = await query(`
      SELECT
        hm.city,
        SUM(CASE WHEN d.date BETWEEN (DATE '${maxDateStr}' - INTERVAL 29 DAY) AND DATE '${maxDateStr}'
            THEN d.delivered_3mr ELSE 0 END)::DOUBLE AS curr_del,
        SUM(CASE WHEN d.date BETWEEN (DATE '${maxDateStr}' - INTERVAL 29 DAY) AND DATE '${maxDateStr}'
            THEN d.assigned_3mr ELSE 0 END)::DOUBLE AS curr_ord,
        SUM(CASE WHEN d.date BETWEEN (DATE '${maxDateStr}' - INTERVAL 59 DAY) AND (DATE '${maxDateStr}' - INTERVAL 30 DAY)
            THEN d.delivered_3mr ELSE 0 END)::DOUBLE AS prev_del,
        SUM(CASE WHEN d.date BETWEEN (DATE '${maxDateStr}' - INTERVAL 59 DAY) AND (DATE '${maxDateStr}' - INTERVAL 30 DAY)
            THEN d.assigned_3mr ELSE 0 END)::DOUBLE AS prev_ord
      FROM v_3mr_delivery d
      LEFT JOIN hub_mapping hm ON d.hub = hm.hub
      WHERE hm.city IS NOT NULL
      GROUP BY hm.city
    `)

    const toNum = (v: unknown) => v == null ? 0 : Number(v)

    // Build trend maps
    type TrendEntry = { delPct: number; prevDelPct: number; delta: number }
    const trend7Map: Record<string, TrendEntry> = {}
    for (const r of trendRows7) {
      const city = r.city as string
      const currDelPct = toNum(r.curr_ord) > 0 ? toNum(r.curr_del) / toNum(r.curr_ord) * 100 : 0
      const prevDelPct = toNum(r.prev_ord) > 0 ? toNum(r.prev_del) / toNum(r.prev_ord) * 100 : 0
      trend7Map[city] = { delPct: currDelPct, prevDelPct, delta: currDelPct - prevDelPct }
    }
    const trend30Map: Record<string, TrendEntry> = {}
    for (const r of trendRows30) {
      const city = r.city as string
      const currDelPct = toNum(r.curr_ord) > 0 ? toNum(r.curr_del) / toNum(r.curr_ord) * 100 : 0
      const prevDelPct = toNum(r.prev_ord) > 0 ? toNum(r.prev_del) / toNum(r.prev_ord) * 100 : 0
      trend30Map[city] = { delPct: currDelPct, prevDelPct, delta: currDelPct - prevDelPct }
    }

    return NextResponse.json({
      dateRange: { start: startDate, end: endDate, preset: datePreset },
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
        riderId: String(r.rider_id),
        riderName: r.rider_name ?? '',
        hub: r.hub ?? '',
        city: r.city ?? '',
        behaviourTag: r.behaviour_tag ?? 'Morning Rider',
        regularityTag: r.regularity_tag ?? 'Regular',
        orders3MR: toNum(r.orders_3mr),
        delivered3MR: toNum(r.delivered_3mr),
        delPct: toNum(r.del_pct),
        breachCount: toNum(r.breach_count),
      })),
    })
  } catch (err) {
    console.error('[API /delivery]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
