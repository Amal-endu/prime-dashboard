export const runtime = 'nodejs'
import { NextResponse } from 'next/server'
import { query } from '@/backend/db'

// Returns the FROM + WHERE fragment for aggregating SDD shipments.
// mode='3mr'     → v_3mr_delivery  (received_at_hub_time >= 15:00, already filtered in view)
// mode='overall' → sdd_awbs direct  (all dispatched AWBs regardless of time)
function sddSource(mode: string, startDate: string, endDate: string) {
  if (mode === 'overall') {
    return {
      cte: `
        overall_src AS (
          SELECT
            ofd_date AS date,
            hub,
            rider_id,
            COUNT(*) AS assigned_3mr,
            SUM(CASE WHEN latest_status IN ('DELIVERED','CID','NOT_CONTACTABLE') THEN 1 ELSE 0 END) AS attempted_3mr,
            SUM(CASE WHEN latest_status = 'DELIVERED' THEN 1 ELSE 0 END) AS delivered_3mr,
            SUM(CASE WHEN breach THEN 1 ELSE 0 END) AS breach_count
          FROM (
            SELECT
              TRY_CAST(ofd_time AS TIMESTAMP)::DATE AS ofd_date,
              hub, rider_id, latest_status, breach
            FROM sdd_awbs
            WHERE ofd_time IS NOT NULL
              AND rider_id IS NOT NULL
              AND TRY_CAST(ofd_time AS TIMESTAMP)::DATE BETWEEN '${startDate}' AND '${endDate}'
          ) src
          GROUP BY ofd_date, hub, rider_id
        )`,
      table: 'overall_src',
    }
  }
  // 3mr: use the pre-filtered view
  return {
    cte: '',
    table: 'v_3mr_delivery',
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const dateFilter = searchParams.get('date') ?? 'today'
  const behaviour = searchParams.get('behaviour')
  const regularity = searchParams.get('regularity')
  const mode = searchParams.get('mode') === 'overall' ? 'overall' : '3mr'

  try {
    const [{ max_date }] = await query('SELECT max_date FROM v_max_date')
    const maxDate = new Date(max_date as string)

    const fmt = (d: Date) => d.toISOString().slice(0, 10)
    const offsetDate = (days: number) => {
      const d = new Date(maxDate); d.setDate(d.getDate() - days); return d
    }

    let startDate: string
    let endDate: string = fmt(maxDate)

    const singleDayMatch = dateFilter.match(/^d(\d+)$/)
    if (singleDayMatch) {
      const n = parseInt(singleDayMatch[1], 10)
      startDate = endDate = fmt(offsetDate(n))
    } else if (dateFilter === 'l7d') {
      startDate = fmt(offsetDate(6))
    } else if (dateFilter === 'l30d') {
      startDate = fmt(offsetDate(29))
    } else {
      startDate = endDate = fmt(maxDate)
    }

    const src = sddSource(mode, startDate, endDate)
    const withCte = src.cte ? `WITH ${src.cte},` : 'WITH'
    const tbl = src.table
    // For v_3mr_delivery the date column is already filtered; for overall_src we filter inside the CTE
    const dateWhere = mode === 'overall'
      ? `WHERE ${tbl}.date BETWEEN '${startDate}' AND '${endDate}'`
      : `WHERE ${tbl}.date BETWEEN '${startDate}' AND '${endDate}'`

    const riderRows = await query(`
      ${withCte}
      del AS (
        SELECT
          ${tbl}.rider_id,
          ${tbl}.hub,
          SUM(${tbl}.assigned_3mr)   AS assigned_3mr,
          SUM(${tbl}.attempted_3mr)  AS attempted_3mr,
          SUM(${tbl}.delivered_3mr)  AS delivered_3mr,
          SUM(${tbl}.breach_count)   AS breach_count,
          MAX(hm.city)               AS city
        FROM ${tbl}
        LEFT JOIN hub_mapping hm ON ${tbl}.hub = hm.hub
        ${dateWhere}
        GROUP BY ${tbl}.rider_id, ${tbl}.hub
      ),
      rs AS (
        SELECT DISTINCT ON (rider_id)
          rider_id,
          rider_name,
          login_behaviour_tag,
          regularity_tag
        FROM v_rider_summary
        WHERE 1=1
          ${behaviour ? `AND login_behaviour_tag = '${behaviour.replace(/'/g, "''")}'` : ''}
          ${regularity ? `AND regularity_tag = '${regularity.replace(/'/g, "''")}'` : ''}
      ),
      cpo_join AS (
        SELECT d.*, c.total_pay AS cpo
        FROM del d
        LEFT JOIN cpo c ON d.city = c.city
      ),
      raw_agg AS (
        SELECT
          rider_id,
          ROUND(AVG(CASE WHEN attempt_morning > 0 THEN attempt_morning END), 1)       AS avg_morning_productivity,
          ROUND(AVG(CASE WHEN attempt_evening > 0 THEN attempt_evening END), 1)       AS avg_evening_productivity,
          ROUND(AVG(CASE WHEN morning_runsheet_hour IS NOT NULL THEN morning_runsheet_hour END), 1) AS avg_morning_runsheet_hr,
          ROUND(AVG(CASE WHEN evening_runsheet_hour IS NOT NULL THEN evening_runsheet_hour END), 1) AS avg_evening_runsheet_hr
        FROM rider_daily
        WHERE date BETWEEN '${startDate}' AND '${endDate}'
        GROUP BY rider_id
      )
      SELECT
        cj.rider_id,
        rs.rider_name,
        cj.hub,
        cj.city,
        rs.login_behaviour_tag,
        rs.regularity_tag,
        cj.assigned_3mr,
        cj.attempted_3mr,
        cj.delivered_3mr,
        ROUND(cj.attempted_3mr * 100.0 / NULLIF(cj.assigned_3mr, 0), 1) AS attempt_prod_pct,
        ROUND(cj.delivered_3mr * 100.0 / NULLIF(cj.assigned_3mr, 0), 1) AS delivered_prod_pct,
        ROUND(cj.delivered_3mr * COALESCE(cj.cpo, 0), 0)                AS earnings_3mr,
        ra.avg_morning_productivity,
        ra.avg_evening_productivity,
        ra.avg_morning_runsheet_hr,
        ra.avg_evening_runsheet_hr
      FROM cpo_join cj
      LEFT JOIN rs ON cj.rider_id = rs.rider_id
      LEFT JOIN raw_agg ra ON cj.rider_id = ra.rider_id
      ORDER BY cj.city, cj.hub, delivered_prod_pct DESC NULLS LAST
    `)

    const cityRows = await query(`
      ${withCte}
      del AS (
        SELECT
          hm.city,
          SUM(${tbl}.assigned_3mr)        AS assigned_3mr,
          SUM(${tbl}.attempted_3mr)       AS attempted_3mr,
          SUM(${tbl}.delivered_3mr)       AS delivered_3mr,
          COUNT(DISTINCT ${tbl}.rider_id) AS riders_active
        FROM ${tbl}
        LEFT JOIN hub_mapping hm ON ${tbl}.hub = hm.hub
        ${dateWhere}
          AND hm.city IS NOT NULL
        GROUP BY hm.city
      )
      SELECT
        city,
        riders_active,
        assigned_3mr,
        attempted_3mr,
        delivered_3mr,
        ROUND(attempted_3mr * 100.0 / NULLIF(assigned_3mr, 0), 1) AS attempt_prod_pct,
        ROUND(delivered_3mr * 100.0 / NULLIF(assigned_3mr, 0), 1) AS delivered_prod_pct,
        ROUND(delivered_3mr * COALESCE((SELECT total_pay FROM cpo WHERE cpo.city = del.city), 0), 0) AS total_earnings
      FROM del
      ORDER BY delivered_3mr DESC
    `)

    const hubRows = await query(`
      ${withCte}
      agg AS (
        SELECT
          ${tbl}.hub,
          hm.city,
          COUNT(DISTINCT ${tbl}.rider_id)                                              AS riders_active,
          SUM(${tbl}.assigned_3mr)                                                     AS assigned_3mr,
          SUM(${tbl}.attempted_3mr)                                                    AS attempted_3mr,
          SUM(${tbl}.delivered_3mr)                                                    AS delivered_3mr,
          ROUND(SUM(${tbl}.attempted_3mr) * 100.0 / NULLIF(SUM(${tbl}.assigned_3mr), 0), 1) AS attempt_prod_pct,
          ROUND(SUM(${tbl}.delivered_3mr) * 100.0 / NULLIF(SUM(${tbl}.assigned_3mr), 0), 1) AS delivered_prod_pct,
          MAX(c.total_pay)                                                              AS cpo
        FROM ${tbl}
        LEFT JOIN hub_mapping hm ON ${tbl}.hub = hm.hub
        LEFT JOIN cpo c ON hm.city = c.city
        ${dateWhere}
          AND hm.city IS NOT NULL
        GROUP BY ${tbl}.hub, hm.city
      )
      SELECT
        hub, city, riders_active, assigned_3mr, attempted_3mr, delivered_3mr,
        attempt_prod_pct, delivered_prod_pct,
        ROUND(delivered_3mr * COALESCE(cpo, 0), 0) AS total_earnings
      FROM agg
      ORDER BY city, delivered_3mr DESC
    `)

    const toNum = (v: unknown) => v == null ? 0 : Number(v)

    return NextResponse.json({
      dateRange: { start: startDate, end: endDate },
      mode,
      cities: cityRows.map(r => ({
        city: r.city,
        ridersLoggedIn: toNum(r.riders_active),
        assigned3MR: toNum(r.assigned_3mr),
        attempted3MR: toNum(r.attempted_3mr),
        delivered3MR: toNum(r.delivered_3mr),
        avgAttemptProductivityPct: toNum(r.attempt_prod_pct),
        avgDeliveredProductivityPct: toNum(r.delivered_prod_pct),
        totalEarnings3MR: toNum(r.total_earnings),
      })),
      hubs: hubRows.map(r => ({
        hub: r.hub,
        city: r.city,
        ridersLoggedIn: toNum(r.riders_active),
        assigned3MR: toNum(r.assigned_3mr),
        attempted3MR: toNum(r.attempted_3mr),
        delivered3MR: toNum(r.delivered_3mr),
        avgAttemptProductivityPct: toNum(r.attempt_prod_pct),
        avgDeliveredProductivityPct: toNum(r.delivered_prod_pct),
        totalEarnings3MR: toNum(r.total_earnings),
      })),
      riders: riderRows.map(r => ({
        riderId: String(r.rider_id),
        riderName: r.rider_name ?? '',
        hub: r.hub ?? '',
        city: r.city ?? '',
        loginBehaviourTag: r.login_behaviour_tag ?? 'Morning Rider',
        regularityTag: r.regularity_tag ?? 'Regular',
        assigned3MR: toNum(r.assigned_3mr),
        attempted3MR: toNum(r.attempted_3mr),
        delivered3MR: toNum(r.delivered_3mr),
        attemptProductivityPct: toNum(r.attempt_prod_pct),
        deliveredProductivityPct: toNum(r.delivered_prod_pct),
        earnings3MR: toNum(r.earnings_3mr),
        avgMorningProductivity: r.avg_morning_productivity != null ? Number(r.avg_morning_productivity) : null,
        avgEveningProductivity: r.avg_evening_productivity != null ? Number(r.avg_evening_productivity) : null,
        avgMorningRunsheetHr: r.avg_morning_runsheet_hr != null ? Number(r.avg_morning_runsheet_hr) : null,
        avgEveningRunsheetHr: r.avg_evening_runsheet_hr != null ? Number(r.avg_evening_runsheet_hr) : null,
      })),
    })
  } catch (err) {
    console.error('[API /details]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
