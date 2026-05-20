export const runtime = 'nodejs'
import { NextResponse } from 'next/server'
import { query } from '@/backend/db'

export async function GET() {
  try {
    const [{ max_date }] = await query('SELECT max_date FROM v_max_date')
    const [{ total_awbs }] = await query('SELECT COUNT(*) AS total_awbs FROM sdd_awbs')
    const [{ total_riders }] = await query('SELECT COUNT(DISTINCT rider_id) AS total_riders FROM rider_daily')
    const logs = await query('SELECT filename, ingested_at FROM ingest_log ORDER BY ingested_at DESC LIMIT 5')

    const date = new Date(max_date as string)
    const formatted = date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })

    return NextResponse.json({
      maxDate: formatted,
      maxDateRaw: max_date,
      totalAwbs: Number(total_awbs),
      totalRiders: Number(total_riders),
      recentIngests: logs.map(l => ({ filename: l.filename, ingestedAt: l.ingested_at })),
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
