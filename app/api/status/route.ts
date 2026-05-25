export const runtime = 'nodejs'
export const revalidate = 60
import { NextResponse } from 'next/server'
import { query } from '@/lib/supabase/sql'
import { apiError } from '@/lib/validators'

export async function GET() {
  try {
    const anchorRows = await query<{ anchor_date: string; updated_at: string }>(
      'SELECT anchor_date::TEXT AS anchor_date, updated_at FROM data_anchor WHERE id = 1'
    )
    const anchor = anchorRows[0]
    const [{ total_riders }] = await query<{ total_riders: number }>(
      'SELECT COUNT(DISTINCT rider_id) AS total_riders FROM rider_daily'
    )
    const logs = await query<{ filename: string; ingested_at: string }>(
      'SELECT filename, ingested_at FROM ingest_log ORDER BY ingested_at DESC LIMIT 5'
    )

    if (!anchor) {
      return NextResponse.json({ maxDate: null, maxDateRaw: null, totalRiders: 0, recentIngests: [] })
    }

    const date = new Date(anchor.anchor_date)
    const formatted = date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })

    return NextResponse.json({
      maxDate: formatted,
      maxDateRaw: anchor.updated_at,
      totalRiders: Number(total_riders),
      recentIngests: logs.map(l => ({ filename: l.filename, ingestedAt: l.ingested_at })),
    })
  } catch (err) {
    console.error('[API /status]', err)
    const { status, body } = apiError(err)
    return NextResponse.json(body, { status })
  }
}
