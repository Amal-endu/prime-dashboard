#!/usr/bin/env node
/**
 * Builds raw_data.csv from SDD CSVs within the rolling 30-day window.
 *
 * raw_data.csv columns:
 *   date, rider_id, hub, rider_name,
 *   morning_runsheet_hour, evening_runsheet_hour,
 *   attempt_morning, attempt_evening, attempted_total
 *
 * Logic:
 *   - ofd_time hour < MR3_CUTOFF  → morning
 *   - ofd_time hour >= MR3_CUTOFF → evening
 *   - attempted = status in [DELIVERED, CID, NOT_CONTACTABLE]
 *   - morning_runsheet_hour = earliest OFD hour for morning shipments
 *   - evening_runsheet_hour = earliest OFD hour for evening shipments
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env.local') })
const fs   = require('fs')
const path = require('path')
const os   = require('os')
const { parse } = require('csv-parse/sync')

const ROOT          = path.join(__dirname, '..')
const OUT_PATH      = process.env.RAW_DATA_PATH || path.join(ROOT, 'raw_data.csv')
const MR3_CUTOFF    = parseInt(process.env.MR3_CUTOFF_HOUR || '15', 10)
const WINDOW_DAYS   = parseInt(process.env.WINDOW_DAYS || '30', 10)
const SFX_SDD_ROOT  = process.env.SFX_SDD_ROOT
  || path.join(os.homedir(), 'Downloads', 'Sfx Workings', 'SDD_Data')

const MONTH_MAP = {
  jan:'01', feb:'02', mar:'03', apr:'04', may:'05', jun:'06',
  jul:'07', aug:'08', sep:'09', oct:'10', nov:'11', dec:'12',
}

function parseDateFromFilename(filename) {
  const m = filename.match(/(\d{1,2})([A-Za-z]{3})/i)
  if (!m) return null
  const day = m[1].padStart(2, '0')
  const mon = MONTH_MAP[m[2].toLowerCase()]
  if (!mon) return null
  return `${new Date().getFullYear()}-${mon}-${day}`
}

const SDD_DIRS = (process.env.SDD_DATA_DIR
  ? [process.env.SDD_DATA_DIR]
  : [
      path.join(SFX_SDD_ROOT, 'April'),
      path.join(SFX_SDD_ROOT, 'May'),
      path.join(SFX_SDD_ROOT, 'June'),
      path.join(SFX_SDD_ROOT, 'July'),
    ]
).filter(d => fs.existsSync(d))

// Rolling window cutoff
const cutoff = new Date()
cutoff.setDate(cutoff.getDate() - WINDOW_DAYS)
const cutoffStr = cutoff.toISOString().slice(0, 10)

// Collect files within window
const allFiles = []
for (const dir of SDD_DIRS) {
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.csv')) continue
    const d = parseDateFromFilename(f)
    if (d && d >= cutoffStr) allFiles.push({ file: path.join(dir, f), filename: f, date: d })
  }
}
allFiles.sort((a, b) => a.date.localeCompare(b.date))
console.log(`\n📂 ${allFiles.length} SDD files in rolling ${WINDOW_DAYS}-day window (${cutoffStr} → today)\n`)

// Map: `date|rider_id` → aggregated row
const riderMap = {}

function progress(label, i, total) {
  const pct = total > 0 ? i / total : 0
  const filled = Math.round(pct * 30)
  const bar = '█'.repeat(filled) + '░'.repeat(30 - filled)
  process.stdout.write(`\r  [${bar}] ${(pct * 100).toFixed(1).padStart(5)}% ${label}    `)
  if (i >= total) process.stdout.write('\n')
}

const ATTEMPTED_STATUSES = new Set(['DELIVERED', 'CID', 'NOT_CONTACTABLE'])

for (let fi = 0; fi < allFiles.length; fi++) {
  const { file, filename } = allFiles[fi]
  process.stdout.write(`[${fi + 1}/${allFiles.length}] ${filename}\n`)

  const rows = parse(fs.readFileSync(file), { columns: true, skip_empty_lines: true, bom: true })
  const total = rows.length

  for (let i = 0; i < total; i++) {
    if ((i + 1) % 5000 === 0 || i + 1 === total) progress(filename, i + 1, total)

    const r = rows[i]
    if (!r.ofd_time || !r.rider_id) continue

    const ofdTs = new Date(r.ofd_time)
    if (isNaN(ofdTs.getTime())) continue

    const date     = ofdTs.toISOString().slice(0, 10)
    const riderId  = (r.rider_id || '').trim()
    const hub      = (r.hub || '').trim()
    const riderName = (r.rider_name || '').trim() || null
    const ofdHour  = ofdTs.getHours()
    const isMorning = ofdHour < MR3_CUTOFF
    const isAttempted = ATTEMPTED_STATUSES.has(r.latest_status)

    const key = `${date}|${riderId}`
    if (!riderMap[key]) {
      riderMap[key] = {
        date, rider_id: riderId, hub, rider_name: riderName,
        morning_runsheet_hour: null, evening_runsheet_hour: null,
        attempt_morning: 0, attempt_evening: 0, attempted_total: 0,
      }
    }
    const row = riderMap[key]

    // Keep the hub from latest file (most recent wins on conflict)
    if (hub) row.hub = hub
    if (riderName && !row.rider_name) row.rider_name = riderName

    if (isMorning) {
      if (row.morning_runsheet_hour === null || ofdHour < row.morning_runsheet_hour)
        row.morning_runsheet_hour = ofdHour
      if (isAttempted) { row.attempt_morning++; row.attempted_total++ }
    } else {
      if (row.evening_runsheet_hour === null || ofdHour < row.evening_runsheet_hour)
        row.evening_runsheet_hour = ofdHour
      if (isAttempted) { row.attempt_evening++; row.attempted_total++ }
    }
  }
}

// Write CSV
const header = 'date,rider_id,hub,rider_name,morning_runsheet_hour,evening_runsheet_hour,attempt_morning,attempt_evening,attempted_total\n'
const lines = Object.values(riderMap).map(r => [
  r.date,
  r.rider_id,
  r.hub,
  (r.rider_name || '').replace(/,/g, ' '),
  r.morning_runsheet_hour ?? '',
  r.evening_runsheet_hour ?? '',
  r.attempt_morning,
  r.attempt_evening,
  r.attempted_total,
].join(','))

fs.writeFileSync(OUT_PATH, header + lines.join('\n') + '\n')
console.log(`\n✅ raw_data.csv written: ${lines.length} rider-day rows → ${OUT_PATH}\n`)
