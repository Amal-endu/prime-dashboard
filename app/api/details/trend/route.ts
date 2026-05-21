export const runtime = 'nodejs'
export const revalidate = 300
import { NextResponse } from 'next/server'
import { query } from '@/backend/db'
import { apiError, parseHour, parseMode, parseParamString } from '@/lib/validators'

type TrendRow = { riders: number; avgProductivity: number; avgEarnings: number }

// One date-range aggregation. Date-range filtering is parameterized; mode
// selects which physical table/CTE feeds the aggregation.
//   '3mr'     → v_3mr_delivery
//   'overall' → sdd_awbs direct
function buildTrendQuery(
  mode: '3mr' | 'overall',
  labelExpr: string,        // SQL expression for label column (already safe — constants only)
  dateFilterExpr: string,   // SQL fragment with '?' placeholders for date bounds
  cityClause: string,       // '' or 'AND ... = ?'
  labelAlias: string,
  mr3CutoffHour: number,
) {
  if (mode === 'overall') {
    return `
      SELECT
        ${labelExpr} AS ${labelAlias},
        COUNT(DISTINCT rider_id) AS riders,
        ROUND(
          SUM(CASE WHEN latest_status IN ('DELIVERED','CID','NOT_CONTACTABLE') THEN 1 ELSE 0 END)
          / NULLIF(COUNT(DISTINCT rider_id) * NULLIF(COUNT(DISTINCT TRY_CAST(ofd_time AS DATE)), 0), 0),
        1) AS avg_productivity,
        ROUND(
          SUM(CASE WHEN latest_status = 'DELIVERED' THEN 1 ELSE 0 END)
          * COALESCE(MAX(c.total_pay), 0) / NULLIF(COUNT(DISTINCT rider_id), 0),
        0) AS avg_earnings
      FROM sdd_awbs a
      LEFT JOIN hub_mapping hm ON a.hub = hm.hub
      LEFT JOIN cpo c ON hm.city = c.city
      WHERE ofd_time IS NOT NULL
        AND rider_id IS NOT NULL
        AND ${dateFilterExpr}
        ${cityClause}
    `
  }
  return `
    SELECT
      ${labelExpr} AS ${labelAlias},
      COUNT(DISTINCT d.rider_id) AS riders,
      ROUND(
        SUM(d.attempted_3mr)::DOUBLE
        / NULLIF(COUNT(DISTINCT d.rider_id) * NULLIF(COUNT(DISTINCT d.date), 0), 0),
      1) AS avg_productivity,
      ROUND(
        SUM(d.delivered_3mr) * COALESCE(MAX(c.total_pay), 0) /
        NULLIF(COUNT(DISTINCT d.rider_id), 0),
      0) AS avg_earnings
    FROM (
      SELECT
        TRY_CAST(ofd_time AS TIMESTAMP)::DATE AS date,
        hub,
        rider_id,
        attempted_3mr,
        delivered_3mr
      FROM (
        SELECT
          ofd_time, hub, rider_id,
          CASE WHEN latest_status IN ('DELIVERED','CID','NOT_CONTACTABLE') THEN 1 ELSE 0 END AS attempted_3mr,
          CASE WHEN latest_status = 'DELIVERED' THEN 1 ELSE 0 END AS delivered_3mr
        FROM sdd_awbs
        WHERE HOUR(received_at_hub_time) >= ${mr3CutoffHour}
          AND ofd_time IS NOT NULL
          AND rider_id IS NOT NULL
      ) raw
    ) d
    LEFT JOIN hub_mapping hm ON d.hub = hm.hub
    LEFT JOIN cpo c ON hm.city = c.city
    WHERE ${dateFilterExpr}
      ${cityClause}
  `
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  try {
    const city = parseParamString(searchParams.get('city'), 'city')
    const mode = parseMode(searchParams.get('mode'))
    const mr3CutoffHour = parseHour(searchParams.get('mr3CutoffHour'), 15)

    const cityClause = city ? `AND COALESCE(hm.city, 'Unmapped') = ?` : ''
    const cityParam = city ? [city] : []

    const [{ max_date }] = await query<{ max_date: string }>('SELECT max_date FROM v_max_date')
    const maxDate = new Date(max_date)

    const fmt = (d: Date) => d.toISOString().slice(0, 10)
    const offset = (days: number) => {
      const d = new Date(maxDate); d.setDate(d.getDate() - days); return d
    }

    const l7dPoints = Array.from({ length: 8 }, (_, i) => ({
      label: `D-${i + 1}`,
      date: fmt(offset(i + 1)),
    }))

    const l30dPoints = [
      { label: 'W-1', start: fmt(offset(7)),  end: fmt(offset(1))  },
      { label: 'W-2', start: fmt(offset(14)), end: fmt(offset(8))  },
      { label: 'W-3', start: fmt(offset(21)), end: fmt(offset(15)) },
      { label: 'W-4', start: fmt(offset(28)), end: fmt(offset(22)) },
    ]

    const dateCol = mode === 'overall'
      ? `TRY_CAST(ofd_time AS TIMESTAMP)::DATE`
      : `d.date`

    // L7D — single query across all 8 days using IN (?, ?, ...)
    const inPlaceholders = l7dPoints.map(() => '?').join(',')
    const dailySql = buildTrendQuery(
      mode,
      `${dateCol}::VARCHAR`,
      `${dateCol} IN (${inPlaceholders})`,
      cityClause,
      'date',
      mr3CutoffHour,
    ) + ` GROUP BY ${dateCol} ORDER BY ${dateCol}`
    const dailyRows = await query<Record<string, unknown>>(
      dailySql,
      [...l7dPoints.map(p => p.date), ...cityParam],
    )

    // L30D — one query per week window
    const weeklyRows = await Promise.all(
      l30dPoints.map(w => {
        const sql = buildTrendQuery(
          mode,
          `?`,
          `${dateCol} BETWEEN ? AND ?`,
          cityClause,
          'week',
          mr3CutoffHour,
        ) + ` GROUP BY week`
        return query<Record<string, unknown>>(sql, [w.label, w.start, w.end, ...cityParam])
      }),
    )

    const dailyMap: Record<string, TrendRow> = {}
    for (const r of dailyRows) {
      dailyMap[r.date as string] = {
        riders: Number(r.riders),
        avgProductivity: Number(r.avg_productivity),
        avgEarnings: Number(r.avg_earnings),
      }
    }

    const weeklyMap: Record<string, TrendRow> = {}
    for (const rows of weeklyRows) {
      if (rows.length > 0) {
        const r = rows[0]
        weeklyMap[r.week as string] = {
          riders: Number(r.riders),
          avgProductivity: Number(r.avg_productivity),
          avgEarnings: Number(r.avg_earnings),
        }
      }
    }

    const l7d = [...l7dPoints].reverse().map(p => ({
      label: p.label,
      ...(dailyMap[p.date] ?? { riders: 0, avgProductivity: 0, avgEarnings: 0 }),
    }))

    const l30d = [...l30dPoints].reverse().map(p => ({
      label: p.label,
      ...(weeklyMap[p.label] ?? { riders: 0, avgProductivity: 0, avgEarnings: 0 }),
    }))

    const cityList = await query<{ city: string }>(
      `SELECT DISTINCT COALESCE(hm.city, 'Unmapped') AS city
         FROM sdd_awbs a
         LEFT JOIN hub_mapping hm ON a.hub = hm.hub
         ORDER BY city`,
    )

    return NextResponse.json({
      l7d,
      l30d,
      cities: cityList.map(r => r.city),
    })
  } catch (err) {
    console.error('[API /details/trend]', err)
    const { status, body } = apiError(err)
    return NextResponse.json(body, { status })
  }
}
