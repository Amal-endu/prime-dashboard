export const runtime = 'nodejs'
export const revalidate = 300
import { NextResponse } from 'next/server'
import { query } from '@/backend/db'
import {
  apiError,
  parseBehaviour,
  parseDatePreset,
  parseHour,
  parseMode,
  parseRegularity,
  resolveDateRange,
} from '@/lib/validators'

// FROM + WHERE fragment for aggregating SDD shipments.
//   '3mr'     → inline subquery replacing v_3mr_delivery (cutoff hour is parameterised)
//   'overall' → sdd_awbs direct  (all dispatched AWBs regardless of time)
function sddSource(mode: '3mr' | 'overall', mr3CutoffHour: number) {
  if (mode === 'overall') {
    return {
      cte: `
        overall_src AS (
          SELECT
            ofd_date AS date,
            src.hub,
            hm.city,
            hm.zone,
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
              AND TRY_CAST(ofd_time AS TIMESTAMP)::DATE BETWEEN ? AND ?
          ) src
          LEFT JOIN hub_mapping hm ON LOWER(TRIM(src.hub)) = LOWER(TRIM(hm.hub))
          GROUP BY ofd_date, src.hub, hm.city, hm.zone, rider_id
        )`,
      table: 'overall_src',
      bindStartEnd: true,
      bindCutoff: false,
    }
  }
  // 3mr mode — inline subquery replacing v_3mr_delivery
  return {
    cte: `
      mr3_src AS (
        SELECT
          TRY_CAST(ofd_time AS TIMESTAMP)::DATE AS date,
          a.hub,
          hm.city,
          hm.zone,
          a.rider_id,
          COUNT(*) AS assigned_3mr,
          SUM(CASE WHEN a.latest_status IN ('DELIVERED','CID','NOT_CONTACTABLE') THEN 1 ELSE 0 END) AS attempted_3mr,
          SUM(CASE WHEN a.latest_status = 'DELIVERED' THEN 1 ELSE 0 END) AS delivered_3mr,
          SUM(CASE WHEN a.breach THEN 1 ELSE 0 END) AS breach_count
        FROM sdd_awbs a
        LEFT JOIN hub_mapping hm ON LOWER(TRIM(a.hub)) = LOWER(TRIM(hm.hub))
        WHERE HOUR(a.received_at_hub_time) >= ?
          AND a.ofd_time IS NOT NULL
          AND a.rider_id IS NOT NULL
        GROUP BY TRY_CAST(ofd_time AS TIMESTAMP)::DATE, a.hub, hm.city, hm.zone, a.rider_id
      )`,
    table: 'mr3_src',
    bindStartEnd: false,
    bindCutoff: true,  // signals that mr3CutoffHour must be prepended to bind params
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)

  try {
    const behaviour = parseBehaviour(searchParams.get('behaviour'))
    const regularity = parseRegularity(searchParams.get('regularity'))
    const mode = parseMode(searchParams.get('mode'))
    const datePreset = parseDatePreset(searchParams.get('date'))
    const mr3CutoffHour = parseHour(searchParams.get('mr3CutoffHour'), 15)

    const [{ max_date }] = await query<{ max_date: string }>('SELECT max_date FROM v_max_date')
    const maxDate = new Date(max_date)
    const { startDate, endDate } = resolveDateRange(datePreset, maxDate)

    const src = sddSource(mode, mr3CutoffHour)
    const withPrefix = src.cte ? `WITH ${src.cte},` : 'WITH'
    const tbl = src.table

    // Bind order for each query: (optional cutoff for 3mr CTE), then (optional CTE start/end for overall),
    // then dateWhere start/end, then behaviour/regularity, then rider_daily date range.
    const cteParams: Array<string | number> = src.bindCutoff
      ? [mr3CutoffHour]
      : src.bindStartEnd ? [startDate, endDate] : []

    const behaviourParam = behaviour ? [behaviour] : []
    const regularityParam = regularity ? [regularity] : []
    const behaviourClause = behaviour ? 'AND login_behaviour_tag = ?' : ''
    const regularityClause = regularity ? 'AND regularity_tag = ?' : ''
    const hasRiderFilters = Boolean(behaviour || regularity)
    const riderJoin = hasRiderFilters ? 'JOIN rs ON cj.rider_id = rs.rider_id' : 'LEFT JOIN rs ON cj.rider_id = rs.rider_id'
    const filteredAggJoin = hasRiderFilters ? 'JOIN rs ON src.rider_id = rs.rider_id' : ''
    const filteredRsCte = hasRiderFilters
      ? `rs AS (
          SELECT DISTINCT ON (rider_id)
            rider_id, login_behaviour_tag, regularity_tag
          FROM v_rider_summary
          WHERE 1=1 ${behaviourClause} ${regularityClause}
        ),`
      : ''

    const riderRows = await query<Record<string, unknown>>(
      `${withPrefix}
      del AS (
        SELECT
          src.rider_id,
          src.hub,
          SUM(src.assigned_3mr)   AS assigned_3mr,
          SUM(src.attempted_3mr)  AS attempted_3mr,
          SUM(src.delivered_3mr)  AS delivered_3mr,
          SUM(src.breach_count)   AS breach_count,
          COALESCE(MAX(src.city), 'Unmapped') AS city
        FROM ${tbl} src
        WHERE src.date BETWEEN ? AND ?
        GROUP BY src.rider_id, src.hub
      ),
      rs AS (
        SELECT DISTINCT ON (rider_id)
          rider_id, rider_name, login_behaviour_tag, regularity_tag
        FROM v_rider_summary
        WHERE 1=1 ${behaviourClause} ${regularityClause}
      ),
      cpo_join AS (
        SELECT d.*, c.total_pay AS cpo
        FROM del d
        LEFT JOIN cpo c ON LOWER(TRIM(d.city)) = LOWER(TRIM(c.city))
      ),
      raw_agg AS (
        SELECT
          rider_id,
          ROUND(AVG(CASE WHEN attempt_morning > 0 THEN attempt_morning END), 1)       AS avg_morning_productivity,
          ROUND(AVG(CASE WHEN attempt_evening > 0 THEN attempt_evening END), 1)       AS avg_evening_productivity,
          ROUND(AVG(CASE WHEN morning_runsheet_hour IS NOT NULL THEN morning_runsheet_hour END), 1) AS avg_morning_runsheet_hr,
          ROUND(AVG(CASE WHEN evening_runsheet_hour IS NOT NULL THEN evening_runsheet_hour END), 1) AS avg_evening_runsheet_hr
        FROM rider_daily
        WHERE date BETWEEN ? AND ?
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
      ${riderJoin}
      LEFT JOIN raw_agg ra ON cj.rider_id = ra.rider_id
      ORDER BY cj.city, cj.hub, delivered_prod_pct DESC NULLS LAST`,
      [...cteParams, startDate, endDate, ...behaviourParam, ...regularityParam, startDate, endDate],
    )

    const cityRows = await query<Record<string, unknown>>(
      `${withPrefix}
      ${filteredRsCte}
      del AS (
        SELECT
          COALESCE(src.city, 'Unmapped')  AS city,
          SUM(src.assigned_3mr)           AS assigned_3mr,
          SUM(src.attempted_3mr)          AS attempted_3mr,
          SUM(src.delivered_3mr)          AS delivered_3mr,
          COUNT(DISTINCT src.rider_id)    AS riders_active
        FROM ${tbl} src
        ${filteredAggJoin}
        WHERE src.date BETWEEN ? AND ?
        GROUP BY COALESCE(src.city, 'Unmapped')
      )
      SELECT
        city,
        riders_active,
        assigned_3mr,
        attempted_3mr,
        delivered_3mr,
        ROUND(attempted_3mr * 100.0 / NULLIF(assigned_3mr, 0), 1) AS attempt_prod_pct,
        ROUND(delivered_3mr * 100.0 / NULLIF(assigned_3mr, 0), 1) AS delivered_prod_pct,
        ROUND(delivered_3mr * COALESCE((SELECT total_pay FROM cpo WHERE LOWER(TRIM(cpo.city)) = LOWER(TRIM(del.city))), 0), 0) AS total_earnings
      FROM del
      ORDER BY delivered_3mr DESC`,
      [...cteParams, ...behaviourParam, ...regularityParam, startDate, endDate],
    )

    const hubRows = await query<Record<string, unknown>>(
      `${withPrefix}
      ${filteredRsCte}
      agg AS (
        SELECT
          src.hub,
          COALESCE(src.city, 'Unmapped')                                                   AS city,
          COUNT(DISTINCT src.rider_id)                                                      AS riders_active,
          SUM(src.assigned_3mr)                                                             AS assigned_3mr,
          SUM(src.attempted_3mr)                                                            AS attempted_3mr,
          SUM(src.delivered_3mr)                                                            AS delivered_3mr,
          ROUND(SUM(src.attempted_3mr) * 100.0 / NULLIF(SUM(src.assigned_3mr), 0), 1)        AS attempt_prod_pct,
          ROUND(SUM(src.delivered_3mr) * 100.0 / NULLIF(SUM(src.assigned_3mr), 0), 1)        AS delivered_prod_pct,
          MAX(c.total_pay)                                                                  AS cpo
        FROM ${tbl} src
        ${filteredAggJoin}
        LEFT JOIN cpo c ON LOWER(TRIM(COALESCE(src.city, 'Unmapped'))) = LOWER(TRIM(c.city))
        WHERE src.date BETWEEN ? AND ?
        GROUP BY src.hub, COALESCE(src.city, 'Unmapped')
      )
      SELECT
        hub, city, riders_active, assigned_3mr, attempted_3mr, delivered_3mr,
        attempt_prod_pct, delivered_prod_pct,
        ROUND(delivered_3mr * COALESCE(cpo, 0), 0) AS total_earnings
      FROM agg
      ORDER BY city, delivered_3mr DESC`,
      [...cteParams, ...behaviourParam, ...regularityParam, startDate, endDate],
    )

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
    const { status, body } = apiError(err)
    return NextResponse.json(body, { status })
  }
}
