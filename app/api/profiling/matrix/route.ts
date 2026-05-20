export const runtime = 'nodejs'
import { NextResponse } from 'next/server'
import { query } from '@/backend/db'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const city = searchParams.get('city')  // city name, or null for all
  const hub  = searchParams.get('hub')   // hub name, or null for all

  // v_rider_summary already has city and hub columns — no extra JOIN needed
  const cityClause = city ? `AND COALESCE(city, 'Unmapped') = '${city.replace(/'/g, "''")}'` : ''
  const hubClause  = hub  ? `AND hub = '${hub.replace(/'/g, "''")}'` : ''

  try {
    // All cities present in v_rider_summary
    const cityList = await query(`
      SELECT DISTINCT COALESCE(city, 'Unmapped') AS city
      FROM v_rider_summary
      ORDER BY city
    `)

    // Hubs — scoped to selected city when one is chosen
    const hubList = city
      ? await query(`
          SELECT DISTINCT hub
          FROM v_rider_summary
          WHERE COALESCE(city, 'Unmapped') = '${city.replace(/'/g, "''")}'
          ORDER BY hub
        `)
      : await query(`SELECT DISTINCT hub FROM v_rider_summary ORDER BY hub`)

    // Matrix — filtered by city and/or hub
    const matrixRows = await query(`
      SELECT
        regularity_tag,
        login_behaviour_tag,
        COUNT(*) AS n
      FROM v_rider_summary
      WHERE 1=1 ${cityClause} ${hubClause}
      GROUP BY regularity_tag, login_behaviour_tag
      ORDER BY regularity_tag, login_behaviour_tag
    `)

    const [{ n: scopeTotal }] = await query(`
      SELECT COUNT(*) AS n
      FROM v_rider_summary
      WHERE 1=1 ${cityClause} ${hubClause}
    `)

    type MatrixCell = { evening: number; cross: number; morning: number; total: number }
    const matrix: Record<string, MatrixCell> = {
      Regular:     { evening: 0, cross: 0, morning: 0, total: 0 },
      Irregular:   { evening: 0, cross: 0, morning: 0, total: 0 },
      'New Rider': { evening: 0, cross: 0, morning: 0, total: 0 },
    }
    for (const r of matrixRows) {
      const reg = r.regularity_tag as string
      const beh = r.login_behaviour_tag as string
      const n = Number(r.n)
      if (!matrix[reg]) matrix[reg] = { evening: 0, cross: 0, morning: 0, total: 0 }
      if (beh === 'Evening Rider')   matrix[reg].evening = n
      else if (beh === 'Cross Utilised') matrix[reg].cross = n
      else if (beh === 'Morning Rider')  matrix[reg].morning = n
      matrix[reg].total += n
    }

    return NextResponse.json({
      matrix,
      total: Number(scopeTotal),
      cities: cityList.map(r => r.city as string),
      hubs: hubList.map(r => r.hub as string),
    })
  } catch (err) {
    console.error('[API /profiling/matrix]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
