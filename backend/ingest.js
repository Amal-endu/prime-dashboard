#!/usr/bin/env node
/**
 * Prime Dashboard — Postgres Ingest Script
 * Loads raw_data.csv into rider_daily and SDD CSVs into pre-agg tables.
 * Run: node backend/ingest.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env.local') })
const { Pool } = require('pg')
const fs = require('fs')
const path = require('path')
const { parse } = require('csv-parse/sync')

const ROOT = path.join(__dirname, '..')
const RAW_DATA_PATH = process.env.RAW_DATA_PATH || path.join(ROOT, 'raw_data.csv')
const SDD_DIR = process.env.SDD_DATA_DIR || path.join(ROOT, 'SDD_Data', 'May')
const MR3_CUTOFF = parseInt(process.env.MR3_CUTOFF_HOUR || '15', 10)

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 3,
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

async function ingestRiderDaily() {
  if (!fs.existsSync(RAW_DATA_PATH)) {
    console.log('raw_data.csv not found, skipping rider_daily ingest')
    return
  }
  console.log('Ingesting rider_daily from raw_data.csv...')
  const rows = parse(fs.readFileSync(RAW_DATA_PATH), { columns: true, skip_empty_lines: true })
  let inserted = 0
  for (const r of rows) {
    await query(`
      INSERT INTO rider_daily
        (date, rider_id, hub, rider_name, morning_runsheet_hour, evening_runsheet_hour,
         attempt_morning, attempt_evening, attempted_total)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (date, rider_id) DO UPDATE SET
        hub = EXCLUDED.hub,
        rider_name = EXCLUDED.rider_name,
        morning_runsheet_hour = EXCLUDED.morning_runsheet_hour,
        evening_runsheet_hour = EXCLUDED.evening_runsheet_hour,
        attempt_morning = EXCLUDED.attempt_morning,
        attempt_evening = EXCLUDED.attempt_evening,
        attempted_total = EXCLUDED.attempted_total
    `, [
      r.date,
      r.rider_id,
      r.hub,
      r.rider_name || null,
      r.morning_runsheet_hour ? parseInt(r.morning_runsheet_hour) : null,
      r.evening_runsheet_hour ? parseInt(r.evening_runsheet_hour) : null,
      parseInt(r.attempt_morning || '0'),
      parseInt(r.attempt_evening || '0'),
      parseInt(r.attempted_total || '0'),
    ])
    inserted++
  }
  console.log(`rider_daily: ${inserted} rows upserted`)
}

async function ingestSddCsv(filePath) {
  console.log(`Ingesting SDD file: ${path.basename(filePath)}`)
  const rows = parse(fs.readFileSync(filePath), { columns: true, skip_empty_lines: true })

  const pcRows = await query('SELECT client_name FROM prime_clients')
  const primeSet = new Set(pcRows.map(r => r.client_name.toLowerCase().trim()))

  const riderDayMap = {}
  const clientDayMap = {}

  for (const r of rows) {
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
    const isBreach = ['true', '1', 'yes'].includes((r.breach || '').toLowerCase())

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

  for (const rd of Object.values(riderDayMap)) {
    await query(`
      INSERT INTO rider_day_shipments
        (date, rider_id, hub, assigned_3mr, attempted_3mr, delivered_3mr, breach_count_3mr,
         assigned_overall, attempted_overall, delivered_overall, breach_count_overall)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      ON CONFLICT (date, rider_id, hub) DO UPDATE SET
        assigned_3mr = EXCLUDED.assigned_3mr,
        attempted_3mr = EXCLUDED.attempted_3mr,
        delivered_3mr = EXCLUDED.delivered_3mr,
        breach_count_3mr = EXCLUDED.breach_count_3mr,
        assigned_overall = EXCLUDED.assigned_overall,
        attempted_overall = EXCLUDED.attempted_overall,
        delivered_overall = EXCLUDED.delivered_overall,
        breach_count_overall = EXCLUDED.breach_count_overall
    `, [rd.date, rd.rider_id, rd.hub, rd.assigned_3mr, rd.attempted_3mr, rd.delivered_3mr,
        rd.breach_count_3mr, rd.assigned_overall, rd.attempted_overall, rd.delivered_overall,
        rd.breach_count_overall])
  }

  for (const cd of Object.values(clientDayMap)) {
    await query(`
      INSERT INTO client_day_shipments
        (date, client_name, is_prime, awbs_3mr, delivered_3mr, awbs_overall, delivered_overall)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (date, client_name) DO UPDATE SET
        is_prime = EXCLUDED.is_prime,
        awbs_3mr = EXCLUDED.awbs_3mr,
        delivered_3mr = EXCLUDED.delivered_3mr,
        awbs_overall = EXCLUDED.awbs_overall,
        delivered_overall = EXCLUDED.delivered_overall
    `, [cd.date, cd.client_name, cd.is_prime, cd.awbs_3mr, cd.delivered_3mr, cd.awbs_overall, cd.delivered_overall])
  }

  console.log(`  rider_day_shipments: ${Object.keys(riderDayMap).length} rows`)
  console.log(`  client_day_shipments: ${Object.keys(clientDayMap).length} rows`)
}

async function refreshHubDayL8d() {
  console.log('Refreshing hub_day_l8d...')
  await query(`
    INSERT INTO hub_day_l8d
      (date, hub, city, zone,
       riders_active,
       assigned_3mr, attempted_3mr, delivered_3mr, breach_count_3mr,
       assigned_overall, attempted_overall, delivered_overall, breach_count_overall)
    SELECT
      s.date,
      s.hub,
      COALESCE(hm.city, 'Unmapped') AS city,
      hm.zone,
      COUNT(DISTINCT s.rider_id)    AS riders_active,
      SUM(s.assigned_3mr),
      SUM(s.attempted_3mr),
      SUM(s.delivered_3mr),
      SUM(s.breach_count_3mr),
      SUM(s.assigned_overall),
      SUM(s.attempted_overall),
      SUM(s.delivered_overall),
      SUM(s.breach_count_overall)
    FROM rider_day_shipments s
    LEFT JOIN hub_mapping hm ON LOWER(s.hub) = LOWER(hm.hub)
    WHERE s.date >= CURRENT_DATE - INTERVAL '8 days'
    GROUP BY s.date, s.hub, hm.city, hm.zone
    ON CONFLICT (date, hub) DO UPDATE SET
      city = EXCLUDED.city,
      zone = EXCLUDED.zone,
      riders_active = EXCLUDED.riders_active,
      assigned_3mr = EXCLUDED.assigned_3mr,
      attempted_3mr = EXCLUDED.attempted_3mr,
      delivered_3mr = EXCLUDED.delivered_3mr,
      breach_count_3mr = EXCLUDED.breach_count_3mr,
      assigned_overall = EXCLUDED.assigned_overall,
      attempted_overall = EXCLUDED.attempted_overall,
      delivered_overall = EXCLUDED.delivered_overall,
      breach_count_overall = EXCLUDED.breach_count_overall
  `)
  console.log('hub_day_l8d refreshed')
}

async function updateDataAnchor() {
  const rdRows = await query('SELECT MAX(date)::TEXT AS rd_max FROM rider_daily')
  const shRows = await query('SELECT MAX(date)::TEXT AS sh_max FROM rider_day_shipments')
  const rd_max = rdRows[0]?.rd_max
  const sh_max = shRows[0]?.sh_max
  if (!rd_max || !sh_max) { console.log('No data yet, skipping anchor update'); return }
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
  try {
    await ingestRiderDaily()

    if (fs.existsSync(SDD_DIR)) {
      const files = fs.readdirSync(SDD_DIR)
        .filter(f => f.endsWith('.csv'))
        .map(f => path.join(SDD_DIR, f))

      for (const file of files) {
        const filename = path.basename(file)
        if (!force) {
          const existing = await query('SELECT filename FROM ingest_log WHERE filename = $1', [filename])
          if (existing.length > 0) { console.log(`Skipping ${filename} (already ingested)`); continue }
        }
        await ingestSddCsv(file)
        await query(`
          INSERT INTO ingest_log (filename, ingested_at, row_count)
          VALUES ($1, NOW(), 0)
          ON CONFLICT (filename) DO UPDATE SET ingested_at = NOW()
        `, [filename])
      }
    } else {
      console.log(`SDD_Data dir not found at ${SDD_DIR}, skipping AWB ingest`)
    }

    await refreshHubDayL8d()
    await updateDataAnchor()
    console.log('Ingest complete.')
  } finally {
    await pool.end()
  }
}

main().catch(e => { console.error(e); process.exit(1) })
