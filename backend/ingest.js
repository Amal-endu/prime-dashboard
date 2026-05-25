#!/usr/bin/env node
/**
 * Prime Dashboard — Postgres Ingest Script
 * Loads raw_data.csv into rider_daily and SDD CSVs into pre-agg tables.
 * Only ingests SDD files within a rolling 30-day window.
 * Run: node backend/ingest.js [--force]
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env.local') })
const { Pool } = require('pg')
const fs = require('fs')
const path = require('path')
const { parse } = require('csv-parse/sync')

const ROOT = path.join(__dirname, '..')
const RAW_DATA_PATH = process.env.RAW_DATA_PATH || path.join(ROOT, 'raw_data.csv')
const MR3_CUTOFF = parseInt(process.env.MR3_CUTOFF_HOUR || '15', 10)
const WINDOW_DAYS = parseInt(process.env.WINDOW_DAYS || '30', 10)

// All folders to scan for SDD CSVs — add new month folders here
const SFX_SDD_ROOT = process.env.SFX_SDD_ROOT
  || path.join(require('os').homedir(), 'Downloads', 'Sfx Workings', 'SDD_Data')

const SDD_DIRS = (process.env.SDD_DATA_DIR
  ? [process.env.SDD_DATA_DIR]
  : [
      path.join(SFX_SDD_ROOT, 'April'),
      path.join(SFX_SDD_ROOT, 'May'),
      path.join(SFX_SDD_ROOT, 'June'),
      path.join(SFX_SDD_ROOT, 'July'),
    ]
).filter(d => fs.existsSync(d))

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
})

async function query(sql, params = []) {
  const client = await pool.connect()
  try {
    const result = await client.query(sql, params)
    return result.rows
  } finally {
    client.release()
  }
}

// ── Progress bar ──────────────────────────────────────────────────────────────
function progress(label, current, total, extra = '') {
  const width = 30
  const pct = total > 0 ? current / total : 0
  const filled = Math.round(pct * width)
  const bar = '█'.repeat(filled) + '░'.repeat(width - filled)
  const pctStr = (pct * 100).toFixed(1).padStart(5)
  process.stdout.write(`\r  [${bar}] ${pctStr}% ${label} ${extra}          `)
  if (current >= total) process.stdout.write('\n')
}

// ── Date parsing from filename ────────────────────────────────────────────────
const MONTH_MAP = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
}

function parseDateFromFilename(filename) {
  // Matches: SDD_Data_24May.csv, SDD_Data_9Apr.csv, SDD_Data_1May.csv etc.
  const m = filename.match(/(\d{1,2})([A-Za-z]{3})/i)
  if (!m) return null
  const day = m[1].padStart(2, '0')
  const mon = MONTH_MAP[m[2].toLowerCase()]
  if (!mon) return null
  const year = new Date().getFullYear()
  return `${year}-${mon}-${day}`
}

// ── Ingest raw_data.csv → rider_daily ────────────────────────────────────────
async function ingestRiderDaily() {
  if (!fs.existsSync(RAW_DATA_PATH)) {
    console.log('raw_data.csv not found, skipping rider_daily ingest')
    return
  }
  console.log('Ingesting rider_daily from raw_data.csv...')
  const rows = parse(fs.readFileSync(RAW_DATA_PATH), { columns: true, skip_empty_lines: true })
  const valid = rows.filter(r => r.date && r.rider_id)
  const CHUNK = 500
  let inserted = 0
  for (let i = 0; i < valid.length; i += CHUNK) {
    const chunk = valid.slice(i, i + CHUNK)
    const vals = chunk.map((_, j) => {
      const b = j * 9
      return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8},$${b+9})`
    }).join(',')
    const params = chunk.flatMap(r => [
      r.date, r.rider_id, r.hub, r.rider_name || null,
      r.morning_runsheet_hour !== '' ? parseInt(r.morning_runsheet_hour) : null,
      r.evening_runsheet_hour !== '' ? parseInt(r.evening_runsheet_hour) : null,
      parseInt(r.attempt_morning || '0'),
      parseInt(r.attempt_evening || '0'),
      parseInt(r.attempted_total || '0'),
    ])
    await query(`
      INSERT INTO rider_daily
        (date, rider_id, hub, rider_name, morning_runsheet_hour, evening_runsheet_hour,
         attempt_morning, attempt_evening, attempted_total)
      VALUES ${vals}
      ON CONFLICT (date, rider_id) DO UPDATE SET
        hub = EXCLUDED.hub,
        rider_name = EXCLUDED.rider_name,
        morning_runsheet_hour = EXCLUDED.morning_runsheet_hour,
        evening_runsheet_hour = EXCLUDED.evening_runsheet_hour,
        attempt_morning = EXCLUDED.attempt_morning,
        attempt_evening = EXCLUDED.attempt_evening,
        attempted_total = EXCLUDED.attempted_total
    `, params)
    inserted += chunk.length
    progress('rider_daily', inserted, valid.length, `(${inserted}/${valid.length} rows)`)
  }
  console.log(`  rider_daily: ${inserted} rows upserted`)
}

// ── Ingest one SDD CSV → rider_day_shipments + client_day_shipments ───────────
async function ingestSddCsv(filePath) {
  const filename = path.basename(filePath)
  const rows = parse(fs.readFileSync(filePath), { columns: true, skip_empty_lines: true })

  const pcRows = await query('SELECT client_name FROM prime_clients')
  const primeSet = new Set(pcRows.map(r => r.client_name.toLowerCase().trim()))

  const riderDayMap = {}
  const clientDayMap = {}
  let processed = 0
  const total = rows.length

  for (const r of rows) {
    processed++
    if (processed % 2000 === 0 || processed === total)
      progress(filename, processed, total, `(${processed}/${total} rows)`)

    if (!r.ofd_time || !r.rider_id) continue

    const ofdTs = new Date(r.ofd_time)
    if (isNaN(ofdTs.getTime())) continue
    const date = ofdTs.toISOString().slice(0, 10)

    const hub = (r.hub || '').trim()
    const riderId = (r.rider_id || '').trim()
    const clientName = (r.client_name || '').trim()

    const receivedTs = r.received_at_hub_time ? new Date(r.received_at_hub_time) : null
    const is3mr = receivedTs && !isNaN(receivedTs.getTime())
      ? receivedTs.getHours() >= MR3_CUTOFF
      : false

    const isDelivered = r.latest_status === 'DELIVERED'
    const isAttempted = ['DELIVERED', 'CID', 'NOT_CONTACTABLE'].includes(r.latest_status)
    const isBreach = ['true', '1', 'yes'].includes((r.Breach || r.breach || '').toLowerCase())

    const rKey = `${date}|${riderId}|${hub}`
    if (!riderDayMap[rKey]) riderDayMap[rKey] = {
      date, rider_id: riderId, hub,
      assigned_3mr: 0, attempted_3mr: 0, delivered_3mr: 0, breach_count_3mr: 0,
      assigned_overall: 0, attempted_overall: 0, delivered_overall: 0, breach_count_overall: 0,
    }
    const rd = riderDayMap[rKey]
    rd.assigned_overall++
    if (isAttempted) rd.attempted_overall++
    if (isDelivered) rd.delivered_overall++
    if (isBreach) rd.breach_count_overall++
    if (is3mr) {
      rd.assigned_3mr++
      if (isAttempted) rd.attempted_3mr++
      if (isDelivered) rd.delivered_3mr++
      if (isBreach) rd.breach_count_3mr++
    }

    if (clientName) {
      const cKey = `${date}|${clientName}`
      const isPrime = primeSet.has(clientName.toLowerCase())
      if (!clientDayMap[cKey]) clientDayMap[cKey] = {
        date, client_name: clientName, is_prime: isPrime,
        awbs_3mr: 0, delivered_3mr: 0, awbs_overall: 0, delivered_overall: 0,
      }
      const cd = clientDayMap[cKey]
      cd.awbs_overall++
      if (isDelivered) cd.delivered_overall++
      if (is3mr) {
        cd.awbs_3mr++
        if (isDelivered) cd.delivered_3mr++
      }
    }
  }

  const riderRows = Object.values(riderDayMap)
  const clientRows = Object.values(clientDayMap)

  // Batch upsert helper — sends CHUNK_SIZE rows per query to avoid timeouts
  const CHUNK = 200

  async function batchUpsertRider(rows) {
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK)
      const vals = chunk.map((rd, j) => {
        const b = j * 11
        return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8},$${b+9},$${b+10},$${b+11})`
      }).join(',')
      const params = chunk.flatMap(rd => [
        rd.date, rd.rider_id, rd.hub,
        rd.assigned_3mr, rd.attempted_3mr, rd.delivered_3mr, rd.breach_count_3mr,
        rd.assigned_overall, rd.attempted_overall, rd.delivered_overall, rd.breach_count_overall,
      ])
      await query(`
        INSERT INTO rider_day_shipments
          (date, rider_id, hub, assigned_3mr, attempted_3mr, delivered_3mr, breach_count_3mr,
           assigned_overall, attempted_overall, delivered_overall, breach_count_overall)
        VALUES ${vals}
        ON CONFLICT (date, rider_id, hub) DO UPDATE SET
          assigned_3mr = EXCLUDED.assigned_3mr, attempted_3mr = EXCLUDED.attempted_3mr,
          delivered_3mr = EXCLUDED.delivered_3mr, breach_count_3mr = EXCLUDED.breach_count_3mr,
          assigned_overall = EXCLUDED.assigned_overall, attempted_overall = EXCLUDED.attempted_overall,
          delivered_overall = EXCLUDED.delivered_overall, breach_count_overall = EXCLUDED.breach_count_overall
      `, params)
      progress('  → uploading rider rows', Math.min(i + CHUNK, rows.length), rows.length)
    }
  }

  async function batchUpsertClient(rows) {
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK)
      const vals = chunk.map((cd, j) => {
        const b = j * 7
        return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7})`
      }).join(',')
      const params = chunk.flatMap(cd => [
        cd.date, cd.client_name, cd.is_prime,
        cd.awbs_3mr, cd.delivered_3mr, cd.awbs_overall, cd.delivered_overall,
      ])
      await query(`
        INSERT INTO client_day_shipments
          (date, client_name, is_prime, awbs_3mr, delivered_3mr, awbs_overall, delivered_overall)
        VALUES ${vals}
        ON CONFLICT (date, client_name) DO UPDATE SET
          is_prime = EXCLUDED.is_prime, awbs_3mr = EXCLUDED.awbs_3mr,
          delivered_3mr = EXCLUDED.delivered_3mr, awbs_overall = EXCLUDED.awbs_overall,
          delivered_overall = EXCLUDED.delivered_overall
      `, params)
      progress('  → uploading client rows', Math.min(i + CHUNK, rows.length), rows.length)
    }
  }

  await batchUpsertRider(riderRows)
  await batchUpsertClient(clientRows)
  console.log(`  ✓ ${riderRows.length} rider rows, ${clientRows.length} client rows`)
}

async function refreshHubDayL8d() {
  process.stdout.write('Refreshing hub_day_l8d...')
  await query(`
    INSERT INTO hub_day_l8d
      (date, hub, city, zone, riders_active,
       assigned_3mr, attempted_3mr, delivered_3mr, breach_count_3mr,
       assigned_overall, attempted_overall, delivered_overall, breach_count_overall)
    SELECT
      s.date, s.hub, COALESCE(hm.city, 'Unmapped') AS city, hm.zone,
      COUNT(DISTINCT s.rider_id) AS riders_active,
      SUM(s.assigned_3mr), SUM(s.attempted_3mr), SUM(s.delivered_3mr), SUM(s.breach_count_3mr),
      SUM(s.assigned_overall), SUM(s.attempted_overall), SUM(s.delivered_overall), SUM(s.breach_count_overall)
    FROM rider_day_shipments s
    LEFT JOIN hub_mapping hm ON LOWER(s.hub) = LOWER(hm.hub)
    WHERE s.date >= CURRENT_DATE - INTERVAL '8 days'
    GROUP BY s.date, s.hub, hm.city, hm.zone
    ON CONFLICT (date, hub) DO UPDATE SET
      city = EXCLUDED.city, zone = EXCLUDED.zone, riders_active = EXCLUDED.riders_active,
      assigned_3mr = EXCLUDED.assigned_3mr, attempted_3mr = EXCLUDED.attempted_3mr,
      delivered_3mr = EXCLUDED.delivered_3mr, breach_count_3mr = EXCLUDED.breach_count_3mr,
      assigned_overall = EXCLUDED.assigned_overall, attempted_overall = EXCLUDED.attempted_overall,
      delivered_overall = EXCLUDED.delivered_overall, breach_count_overall = EXCLUDED.breach_count_overall
  `)
  console.log(' done')
}

async function updateDataAnchor() {
  const rdRows = await query('SELECT MAX(date)::TEXT AS rd_max FROM rider_daily')
  const shRows = await query('SELECT MAX(date)::TEXT AS sh_max FROM rider_day_shipments')
  const rd_max = rdRows[0]?.rd_max || null
  const sh_max = shRows[0]?.sh_max
  if (!sh_max) { console.log('No shipment data yet, skipping anchor update'); return }
  // anchor_date is a generated column (auto-computed from shipments_max), do not insert it
  await query(`
    INSERT INTO data_anchor (id, rider_daily_max, shipments_max, updated_at)
    VALUES (1, $1, $2, NOW())
    ON CONFLICT (id) DO UPDATE SET
      rider_daily_max = EXCLUDED.rider_daily_max,
      shipments_max = EXCLUDED.shipments_max,
      updated_at = NOW()
  `, [rd_max, sh_max])
  console.log(`data_anchor updated: rider_daily=${rd_max}, shipments=${sh_max}`)
}

async function main() {
  const force = process.argv.includes('--force')

  // Rolling window cutoff — only ingest files dated within last WINDOW_DAYS
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - WINDOW_DAYS)
  const cutoffStr = cutoff.toISOString().slice(0, 10)
  console.log(`\n🗓  Rolling ${WINDOW_DAYS}-day window: ${cutoffStr} → today\n`)

  try {
    await ingestRiderDaily()

    // Collect all CSV files across all SDD dirs
    const allFiles = []
    for (const dir of SDD_DIRS) {
      const files = fs.readdirSync(dir)
        .filter(f => f.endsWith('.csv'))
        .map(f => ({ file: path.join(dir, f), filename: f }))
      allFiles.push(...files)
    }

    // Filter to rolling window by filename date
    const windowFiles = allFiles.filter(({ filename }) => {
      const d = parseDateFromFilename(filename)
      return d && d >= cutoffStr
    }).sort((a, b) => a.filename.localeCompare(b.filename))

    const skippedCount = allFiles.length - windowFiles.length
    console.log(`\nFound ${allFiles.length} SDD files total, ${windowFiles.length} within window, ${skippedCount} skipped (older than ${WINDOW_DAYS} days)\n`)

    for (let i = 0; i < windowFiles.length; i++) {
      const { file, filename } = windowFiles[i]
      console.log(`\n[${i + 1}/${windowFiles.length}] ${filename}`)

      if (!force) {
        const existing = await query('SELECT filename FROM ingest_log WHERE filename = $1', [filename])
        if (existing.length > 0) { console.log('  → already ingested, skipping'); continue }
      }

      await ingestSddCsv(file)
      await query(`
        INSERT INTO ingest_log (filename, ingested_at, row_count)
        VALUES ($1, NOW(), 0)
        ON CONFLICT (filename) DO UPDATE SET ingested_at = NOW()
      `, [filename])
    }

    console.log('\n')
    await refreshHubDayL8d()
    await updateDataAnchor()
    console.log('\n✅ Ingest complete.\n')
  } finally {
    await pool.end()
  }
}

main().catch(e => { console.error(e); process.exit(1) })
