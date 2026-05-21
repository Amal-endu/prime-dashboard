#!/usr/bin/env node
/**
 * Prime Dashboard — Folder Watcher
 * Watches SDD_Data/May/ for new CSV files and auto-ingests them.
 * Run alongside Next.js: node backend/watcher.js
 */

const chokidar = require('chokidar')
const path = require('path')
const { exec } = require('child_process')

const ROOT = path.join(__dirname, '..')
const SDD_DIR = process.env.SDD_DATA_DIR || path.join(ROOT, 'SDD_Data', 'May')
const INGEST_SCRIPT = path.join(__dirname, 'ingest.js')

console.log(`[watcher] Watching ${SDD_DIR}`)
console.log(`[watcher] New SDD files will be auto-ingested into prime.duckdb`)

let debounce = null

chokidar.watch(path.join(SDD_DIR, 'SDD_Data_*.csv'), {
  persistent: true,
  ignoreInitial: true,
  awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 500 },
}).on('add', (filePath) => {
  const filename = path.basename(filePath)
  console.log(`[watcher] New file detected: ${filename}`)

  // Debounce in case multiple files land at once
  clearTimeout(debounce)
  debounce = setTimeout(() => {
    console.log(`[watcher] Running ingest for ${filename}...`)
    exec(`node "${INGEST_SCRIPT}"`, (err, stdout, stderr) => {
      if (err) {
        console.error(`[watcher] Ingest failed:`, stderr)
      } else {
        console.log(`[watcher] Ingest complete:`, stdout.trim().split('\n').pop())
      }
    })
  }, 3000)
}).on('error', (err) => {
  console.error('[watcher] Error:', err)
})
