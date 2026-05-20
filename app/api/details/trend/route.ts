export const runtime = 'nodejs'
import { NextResponse } from 'next/server'
import { query } from '@/backend/db'

type TrendRow = { riders: number; attemptPct: number; avgEarnings: number }

// Builds the aggregation SQL for one date range depending on mode.
// mode='3mr'     → v_3mr_delivery (received >= 15:00 baked in)
// mode='overall' → sdd_awbs direct (all dispatched AWBs)
function buildTrendQuery(
  mode: string,
  dateExpr: string,      // SQL expression for x-axis label, e.g. 'd.date::VARCHAR' or ''W-1''
  dateFilter: string,    // SQL WHERE clause fragment, e.g. "d.date IN (...)" or "d.date BETWEEN ..."
  cityClause: string,
  labelAlias: string,    // alias for the label column
) {
  if (mode === 'overall') {
    return `
      SELECT
        ${dateExpr} AS ${labelAlias},
        COUNT(DISTINCT rider_id) AS riders,
        ROUND(
          SUM(CASE WHEN latest_status IN ('DELIVERED','CID','NOT_CONTACTABLE') THEN 1 ELSE 0 END)
          * 100.0 / NULLIF(COUNT(*), 0),
        1) AS attempt_pct,
        ROUND(
          SUM(CASE WHEN latest_status = 'DELIVERED' THEN 1 ELSE 0 END)
          * COALESCE(MAX(c.total_pay), 0) / NULLIF(COUNT(DISTINCT rider_id), 0),
        0) AS avg_earnings
      FROM sdd_awbs a
      LEFT JOIN hub_mapping hm ON a.hub = hm.hub
      LEFT JOIN cpo c ON hm.city = c.city
      WHERE ofd_time IS NOT NULL
        AND rider_id IS NOT NULL
        AND ${dateFilter}
        ${cityClause}
    `
  }
  return `
    SELECT
      ${dateExpr} AS ${labelAlias},
      COUNT(DISTINCT d.rider_id) AS riders,
      ROUND(
        SUM(d.attempted_3mr) * 100.0 / NULLIF(SUM(d.assigned_3mr), 0),
      1) AS attempt_pct,
      ROUND(
        SUM(d.delivered_3mr) * COALESCE(MAX(c.total_pay), 0) /
        NULLIF(COUNT(DISTINCT d.rider_id), 0),
      0) AS avg_earnings
    FROM v_3mr_delivery d
    LEFT JOIN hub_mapping hm ON d.hub = hm.hub
    LEFT JOIN cpo c ON hm.city = c.city
    WHERE ${dateFilter}
      ${cityClause}
  `
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const city = searchParams.get('city')
  const mode = searchParams.get('mode') === 'overall' ? 'overall' : '3mr'

  const cityCol = mode === 'overall' ? 'hm.city' : 'hm.city'
  const cityClause = city
    ? `AND COALESCE(${cityCol}, 'Unmapped') = '${city.replace(/'/g, "''")}'`
    : ''

  try {
    const [{ max_date }] = await query('SELECT max_date FROM v_max_date')
    const maxDate = new Date(max_date as string)

    const fmt = (d: Date) => d.toISOString().slice(0, 10)
    const offset = (days: number) => {
      const d = new Date(maxDate); d.setDate(d.getDate() - days); return d
    }

    const l7dPoints: { label: string; date: string }[] = []
    for (let i = 1; i <= 8; i++) {
      l7dPoints.push({ label: `D-${i}`, date: fmt(offset(i)) })
    }

    const l30dPoints = [
      { label: 'W-1', start: fmt(offset(7)),  end: fmt(offset(1))  },
      { label: 'W-2', start: fmt(offset(14)), end: fmt(offset(8))  },
      { label: 'W-3', start: fmt(offset(21)), end: fmt(offset(15)) },
      { label: 'W-4', start: fmt(offset(28)), end: fmt(offset(22)) },
    ]

    const dateCol = mode === 'overall'
      ? `TRY_CAST(ofd_time AS TIMESTAMP)::DATE`
      : `d.date`

    // L7D — single query for all 8 days
    const dailyRows = await query(
      buildTrendQuery(
        mode,
        `${dateCol}::VARCHAR`,
        `${dateCol} IN (${l7dPoints.map(p => `'${p.date}'`).join(',')})`,
        cityClause,
        'date',
      ) + ` GROUP BY ${dateCol} ORDER BY ${dateCol}`
    )

    // L30D — one query per week window
    const weeklyRows = await Promise.all(
      l30dPoints.map(w =>
        query(
          buildTrendQuery(
            mode,
            `'${w.label}'`,
            `${dateCol} BETWEEN '${w.start}' AND '${w.end}'`,
            cityClause,
            'week',
          ) + ` GROUP BY week`
        )
      )
    )

    const dailyMap: Record<string, TrendRow> = {}
    for (const r of dailyRows) {
      dailyMap[r.date as string] = {
        riders: Number(r.riders),
        attemptPct: Number(r.attempt_pct),
        avgEarnings: Number(r.avg_earnings),
      }
    }

    const weeklyMap: Record<string, TrendRow> = {}
    for (const rows of weeklyRows) {
      if (rows.length > 0) {
        const r = rows[0]
        weeklyMap[r.week as string] = {
          riders: Number(r.riders),
          attemptPct: Number(r.attempt_pct),
          avgEarnings: Number(r.avg_earnings),
        }
      }
    }

    const l7d = [...l7dPoints].reverse().map(p => ({
      label: p.label,
      ...(dailyMap[p.date] ?? { riders: 0, attemptPct: 0, avgEarnings: 0 }),
    }))

    const l30d = [...l30dPoints].reverse().map(p => ({
      label: p.label,
      ...(weeklyMap[p.label] ?? { riders: 0, attemptPct: 0, avgEarnings: 0 }),
    }))

    const cityList = await query(`
      SELECT DISTINCT COALESCE(hm.city, 'Unmapped') AS city
      FROM sdd_awbs a
      LEFT JOIN hub_mapping hm ON a.hub = hm.hub
      ORDER BY city
    `)

    return NextResponse.json({
      l7d,
      l30d,
      cities: cityList.map(r => r.city as string),
    })
  } catch (err) {
    console.error('[API /details/trend]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
