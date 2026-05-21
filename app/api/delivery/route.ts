export const runtime = 'nodejs'
export const revalidate = 300
import { NextResponse } from 'next/server'
import { query } from '@/backend/db'
import {
  apiError,
  parseBehaviour,
  parseDatePreset,
  parseHour,
  parseRegularity,
  resolveDateRange,
} from '@/lib/validators'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  try {
    const behaviour = parseBehaviour(searchParams.get('behaviour'))
    const regularity = parseRegularity(searchParams.get('regularity'))
    const primeOnly = searchParams.get('prime') === 'true'
    const datePreset = parseDatePreset(searchParams.get('date'))

    const [{ max_date }] = await query<{ max_date: string }>('SELECT max_date FROM v_max_date')
    const maxDate = new Date(max_date)
    const maxDateStr = maxDate.toISOString().slice(0, 10)
    const { startDate, endDate } = resolveDateRange(datePreset, maxDate)

    const mr3CutoffHour = parseHour(searchParams.get('mr3CutoffHour'), 15)

    const behaviourClause = behaviour ? 'AND rs.login_behaviour_tag = ?' : ''
    const regularityClause = regularity ? 'AND rs.regularity_tag = ?' : ''
    const primeClause = primeOnly ? 'AND d.is_prime = TRUE' : ''
    const filterParams = [
      ...(behaviour ? [behaviour] : []),
      ...(regularity ? [regularity] : []),
    ]

    const riderRows = await query<Record<string, unknown>>(
      `WITH rs_map AS (
        SELECT DISTINCT ON (rider_id)
          rider_id, login_behaviour_tag, regularity_tag
        FROM v_rider_summary
      )
      SELECT
        d.rider_id,
        MAX(d.rider_name)                                                    AS rider_name,
        d.hub,
        COALESCE(MAX(d.city), 'Unmapped')                                    AS city,
        MAX(rs.login_behaviour_tag)                                          AS behaviour_tag,
        MAX(rs.regularity_tag)                                               AS regularity_tag,
        SUM(d.assigned_3mr)                                                  AS orders_3mr,
        SUM(d.delivered_3mr)                                                 AS delivered_3mr,
        ROUND(SUM(d.delivered_3mr) * 100.0 / NULLIF(SUM(d.assigned_3mr),0), 1) AS del_pct,
        SUM(d.breach_count)                                                  AS breach_count
      FROM (
        SELECT
          TRY_CAST(ofd_time AS TIMESTAMP)::DATE AS date,
          hub,
          rider_id,
          rider_name,
          rider_tag,
          client_name,
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
      LEFT JOIN rs_map rs ON d.rider_id = rs.rider_id
      WHERE d.date BETWEEN ? AND ?
        ${behaviourClause} ${regularityClause} ${primeClause}
      GROUP BY d.rider_id, d.hub
      ORDER BY del_pct ASC NULLS LAST
      LIMIT 5000`,
      [mr3CutoffHour, startDate, endDate, ...filterParams],
    )

    const hubRows = await query<Record<string, unknown>>(
      `WITH rs_map AS (
        SELECT DISTINCT ON (rider_id) rider_id, login_behaviour_tag, regularity_tag
        FROM v_rider_summary
      )
      SELECT
        d.hub,
        COALESCE(MAX(d.city), 'Unmapped')                                       AS city,
        SUM(d.assigned_3mr)                                                     AS orders_3mr,
        SUM(d.delivered_3mr)                                                    AS delivered_3mr,
        ROUND(SUM(d.delivered_3mr) * 100.0 / NULLIF(SUM(d.assigned_3mr),0), 1) AS del_pct,
        SUM(d.breach_count)                                                     AS breach_count,
        ROUND(SUM(d.breach_count)  * 100.0 / NULLIF(SUM(d.assigned_3mr),0), 1) AS breach_pct
      FROM (
        SELECT
          TRY_CAST(ofd_time AS TIMESTAMP)::DATE AS date,
          hub,
          rider_id,
          rider_name,
          rider_tag,
          client_name,
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
      LEFT JOIN rs_map rs ON d.rider_id = rs.rider_id
      WHERE d.date BETWEEN ? AND ?
        ${behaviourClause} ${regularityClause} ${primeClause}
      GROUP BY d.hub
      ORDER BY city, del_pct ASC NULLS LAST`,
      [mr3CutoffHour, startDate, endDate, ...filterParams],
    )

    const cityRows = await query<Record<string, unknown>>(
      `WITH rs_map AS (
        SELECT DISTINCT ON (rider_id) rider_id, login_behaviour_tag, regularity_tag
        FROM v_rider_summary
      )
      SELECT
        COALESCE(d.city, 'Unmapped')                                           AS city,
        SUM(d.assigned_3mr)                                                     AS orders_3mr,
        SUM(d.delivered_3mr)                                                    AS delivered_3mr,
        ROUND(SUM(d.delivered_3mr) * 100.0 / NULLIF(SUM(d.assigned_3mr),0), 1) AS del_pct,
        SUM(d.breach_count)                                                     AS breach_count,
        ROUND(SUM(d.breach_count)  * 100.0 / NULLIF(SUM(d.assigned_3mr),0), 1) AS breach_pct
      FROM (
        SELECT
          TRY_CAST(ofd_time AS TIMESTAMP)::DATE AS date,
          hub,
          rider_id,
          rider_name,
          rider_tag,
          client_name,
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
      LEFT JOIN rs_map rs ON d.rider_id = rs.rider_id
      WHERE d.date BETWEEN ? AND ?
        ${behaviourClause} ${regularityClause} ${primeClause}
      GROUP BY COALESCE(d.city, 'Unmapped')
      ORDER BY del_pct ASC NULLS LAST`,
      [mr3CutoffHour, startDate, endDate, ...filterParams],
    )

    // L7D trend: last 7 days DEL% vs previous 7 days DEL%, using the same filters as the table.
    const trendRows7 = await query<Record<string, unknown>>(
      `WITH rs_map AS (
        SELECT DISTINCT ON (rider_id) rider_id, login_behaviour_tag, regularity_tag
        FROM v_rider_summary
      )
      SELECT
        COALESCE(d.city, 'Unmapped') AS city,
        SUM(CASE WHEN d.date BETWEEN (CAST(? AS DATE) - INTERVAL 6 DAY) AND CAST(? AS DATE)
            THEN d.delivered_3mr ELSE 0 END)::DOUBLE AS curr_del,
        SUM(CASE WHEN d.date BETWEEN (CAST(? AS DATE) - INTERVAL 6 DAY) AND CAST(? AS DATE)
            THEN d.assigned_3mr ELSE 0 END)::DOUBLE AS curr_ord,
        SUM(CASE WHEN d.date BETWEEN (CAST(? AS DATE) - INTERVAL 13 DAY) AND (CAST(? AS DATE) - INTERVAL 7 DAY)
            THEN d.delivered_3mr ELSE 0 END)::DOUBLE AS prev_del,
        SUM(CASE WHEN d.date BETWEEN (CAST(? AS DATE) - INTERVAL 13 DAY) AND (CAST(? AS DATE) - INTERVAL 7 DAY)
            THEN d.assigned_3mr ELSE 0 END)::DOUBLE AS prev_ord
      FROM (
        SELECT
          TRY_CAST(ofd_time AS TIMESTAMP)::DATE AS date,
          hub,
          rider_id,
          rider_name,
          rider_tag,
          client_name,
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
      LEFT JOIN rs_map rs ON d.rider_id = rs.rider_id
      WHERE 1=1
        ${behaviourClause} ${regularityClause} ${primeClause}
      GROUP BY COALESCE(d.city, 'Unmapped')`,
      [mr3CutoffHour, maxDateStr, maxDateStr, maxDateStr, maxDateStr, maxDateStr, maxDateStr, maxDateStr, maxDateStr, ...filterParams],
    )

    // L30D trend: last 30 days DEL% vs previous 30 days DEL%, using the same filters as the table.
    const trendRows30 = await query<Record<string, unknown>>(
      `WITH rs_map AS (
        SELECT DISTINCT ON (rider_id) rider_id, login_behaviour_tag, regularity_tag
        FROM v_rider_summary
      )
      SELECT
        COALESCE(d.city, 'Unmapped') AS city,
        SUM(CASE WHEN d.date BETWEEN (CAST(? AS DATE) - INTERVAL 29 DAY) AND CAST(? AS DATE)
            THEN d.delivered_3mr ELSE 0 END)::DOUBLE AS curr_del,
        SUM(CASE WHEN d.date BETWEEN (CAST(? AS DATE) - INTERVAL 29 DAY) AND CAST(? AS DATE)
            THEN d.assigned_3mr ELSE 0 END)::DOUBLE AS curr_ord,
        SUM(CASE WHEN d.date BETWEEN (CAST(? AS DATE) - INTERVAL 59 DAY) AND (CAST(? AS DATE) - INTERVAL 30 DAY)
            THEN d.delivered_3mr ELSE 0 END)::DOUBLE AS prev_del,
        SUM(CASE WHEN d.date BETWEEN (CAST(? AS DATE) - INTERVAL 59 DAY) AND (CAST(? AS DATE) - INTERVAL 30 DAY)
            THEN d.assigned_3mr ELSE 0 END)::DOUBLE AS prev_ord
      FROM (
        SELECT
          TRY_CAST(ofd_time AS TIMESTAMP)::DATE AS date,
          hub,
          rider_id,
          rider_name,
          rider_tag,
          client_name,
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
      LEFT JOIN rs_map rs ON d.rider_id = rs.rider_id
      WHERE 1=1
        ${behaviourClause} ${regularityClause} ${primeClause}
      GROUP BY COALESCE(d.city, 'Unmapped')`,
      [mr3CutoffHour, maxDateStr, maxDateStr, maxDateStr, maxDateStr, maxDateStr, maxDateStr, maxDateStr, maxDateStr, ...filterParams],
    )

    const toNum = (v: unknown) => v == null ? 0 : Number(v)

    type TrendEntry = { delPct: number; prevDelPct: number; delta: number }
    const buildTrend = (rows: Record<string, unknown>[]) => {
      const map: Record<string, TrendEntry> = {}
      for (const r of rows) {
        const city = r.city as string
        const currDelPct = toNum(r.curr_ord) > 0 ? toNum(r.curr_del) / toNum(r.curr_ord) * 100 : 0
        const prevDelPct = toNum(r.prev_ord) > 0 ? toNum(r.prev_del) / toNum(r.prev_ord) * 100 : 0
        map[city] = { delPct: currDelPct, prevDelPct, delta: currDelPct - prevDelPct }
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
    const { status, body } = apiError(err)
    return NextResponse.json(body, { status })
  }
}
