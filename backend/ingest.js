#!/usr/bin/env node
/**
 * Prime Dashboard — DuckDB Ingest Script
 *
 * Loads reference files and SDD CSVs into prime.duckdb.
 * Safe to re-run — uses INSERT OR REPLACE / CREATE OR REPLACE.
 * Run: node backend/ingest.js
 */

const duckdb = require('duckdb')
const path = require('path')
const fs = require('fs')

const ROOT = path.join(__dirname, '..')
const DB_PATH = path.join(ROOT, 'prime.duckdb')
const SDD_DIR = path.join('/Users/amalendu/Downloads/Sfx Workings/SDD_Data/May')
const RAW_DATA_PATH = path.join(ROOT, 'raw_data.csv')
const HUB_MAPPING_PATH = path.join(ROOT, 'hub_mapping.csv')
const CPO_PATH = path.join(ROOT, 'CPO.csv')
const PRIME_CLIENTS_PATH = path.join(ROOT, 'prime_clients.csv')

const db = new duckdb.Database(DB_PATH)
const conn = db.connect()

function run(sql) {
  return new Promise((resolve, reject) => {
    conn.run(sql, (err) => {
      if (err) { console.error('SQL error:', sql.slice(0, 120)); reject(err) }
      else resolve()
    })
  })
}

function all(sql) {
  return new Promise((resolve, reject) => {
    conn.all(sql, (err, rows) => {
      if (err) reject(err)
      else resolve(rows)
    })
  })
}

async function createTables() {
  console.log('Creating tables...')

  await run(`
    CREATE TABLE IF NOT EXISTS hub_mapping (
      hub        VARCHAR,
      pod_name   VARCHAR,
      zone       VARCHAR,
      city       VARCHAR,
      PRIMARY KEY (hub)
    )
  `)

  await run(`
    CREATE TABLE IF NOT EXISTS cpo (
      city       VARCHAR PRIMARY KEY,
      base_pay   DOUBLE,
      sdd_pay    DOUBLE,
      total_pay  DOUBLE
    )
  `)

  await run(`
    CREATE TABLE IF NOT EXISTS prime_clients (
      client_name VARCHAR PRIMARY KEY
    )
  `)

  // Raw rider-per-day data (from raw_data.csv — pre-aggregated)
  await run(`
    CREATE TABLE IF NOT EXISTS rider_daily (
      date                       DATE,
      hub                        VARCHAR,
      rider_id                   VARCHAR,
      rider_name                 VARCHAR,
      morning_runsheet_hour      INTEGER,
      evening_runsheet_hour      INTEGER,
      attempt_morning            INTEGER,
      attempt_evening            INTEGER,
      attempted_total            INTEGER,
      PRIMARY KEY (date, rider_id)
    )
  `)

  // SDD AWB-level data (from daily CSV files)
  await run(`
    CREATE TABLE IF NOT EXISTS sdd_awbs (
      awb_number            VARCHAR,
      date                  DATE,
      hub                   VARCHAR,
      rider_id              VARCHAR,
      rider_name            VARCHAR,
      rider_tag             VARCHAR,
      client_name           VARCHAR,
      latest_status         VARCHAR,
      received_at_hub_time  TIMESTAMP,
      ofd_time              TIMESTAMP,
      first_runsheet_time   TIMESTAMP,
      breach                BOOLEAN,
      pod_mapping           VARCHAR,
      pod_zone              VARCHAR,
      city_id               INTEGER,
      PRIMARY KEY (awb_number)
    )
  `)

  // Ingest status tracker
  await run(`
    CREATE TABLE IF NOT EXISTS ingest_log (
      filename      VARCHAR PRIMARY KEY,
      ingested_at   TIMESTAMP DEFAULT now(),
      row_count     INTEGER
    )
  `)
}

async function loadReferenceFiles() {
  console.log('Loading hub_mapping.csv...')
  await run(`DELETE FROM hub_mapping`)
  await run(`
    INSERT INTO hub_mapping
    SELECT
      TRIM(column0)  AS hub,
      TRIM(column1)  AS pod_name,
      TRIM(column2)  AS zone,
      TRIM(column3)  AS city
    FROM read_csv('${HUB_MAPPING_PATH}', header=true, columns={
      'column0': 'VARCHAR',
      'column1': 'VARCHAR',
      'column2': 'VARCHAR',
      'column3': 'VARCHAR'
    })
  `)
  const [{ n }] = await all(`SELECT COUNT(*) AS n FROM hub_mapping`)
  console.log(`  Loaded ${n} hub mappings`)

  console.log('Loading CPO.csv...')
  await run(`DELETE FROM cpo`)
  await run(`
    INSERT INTO cpo
    SELECT
      TRIM(column0)          AS city,
      TRY_CAST(column1 AS DOUBLE) AS base_pay,
      TRY_CAST(column2 AS DOUBLE) AS sdd_pay,
      TRY_CAST(column3 AS DOUBLE) AS total_pay
    FROM read_csv('${CPO_PATH}', header=true, columns={
      'column0': 'VARCHAR',
      'column1': 'VARCHAR',
      'column2': 'VARCHAR',
      'column3': 'VARCHAR'
    })
    WHERE TRIM(column0) != ''
  `)
  const [{ nc }] = await all(`SELECT COUNT(*) AS nc FROM cpo`)
  console.log(`  Loaded ${nc} city CPO records`)

  console.log('Loading prime_clients.csv...')
  await run(`DELETE FROM prime_clients`)
  await run(`
    INSERT INTO prime_clients
    SELECT TRIM(column0) AS client_name
    FROM read_csv('${PRIME_CLIENTS_PATH}', header=true, columns={'column0':'VARCHAR'})
    WHERE TRIM(column0) != ''
  `)
  const [{ np }] = await all(`SELECT COUNT(*) AS np FROM prime_clients`)
  console.log(`  Loaded ${np} prime clients`)
}

async function loadRawData() {
  console.log('Loading raw_data.csv (pre-aggregated rider daily data)...')
  await run(`DELETE FROM rider_daily`)
  await run(`
    INSERT INTO rider_daily
    SELECT
      STRPTIME(TRIM(dates), '%d-%m-%Y')::DATE   AS date,
      TRIM(hub)                                  AS hub,
      CAST(rider_id AS VARCHAR)                  AS rider_id,
      TRIM(rider_name)                           AS rider_name,
      TRY_CAST(first_runsheet_hour_in_morning_run AS INTEGER) AS morning_runsheet_hour,
      TRY_CAST(first_runsheet_hour_in_evening_run AS INTEGER) AS evening_runsheet_hour,
      TRY_CAST(attempt_in_morning_run AS INTEGER)             AS attempt_morning,
      TRY_CAST(attempt_in_evening_run AS INTEGER)             AS attempt_evening,
      TRY_CAST(attempted_shipment AS INTEGER)                 AS attempted_total
    FROM read_csv('${RAW_DATA_PATH}', header=true, all_varchar=true)
    ON CONFLICT (date, rider_id) DO UPDATE SET
      hub                   = excluded.hub,
      rider_name            = excluded.rider_name,
      morning_runsheet_hour = excluded.morning_runsheet_hour,
      evening_runsheet_hour = excluded.evening_runsheet_hour,
      attempt_morning       = excluded.attempt_morning,
      attempt_evening       = excluded.attempt_evening,
      attempted_total       = excluded.attempted_total
  `)
  const [{ n }] = await all(`SELECT COUNT(*) AS n FROM rider_daily`)
  console.log(`  Loaded ${n} rider-day records`)
}

async function loadSddFile(filePath) {
  const filename = path.basename(filePath)

  // Skip if already ingested
  const existing = await all(`SELECT filename FROM ingest_log WHERE filename = '${filename}'`)
  if (existing.length > 0) {
    console.log(`  Skipping ${filename} (already ingested)`)
    return
  }

  console.log(`  Ingesting ${filename}...`)
  try {
    await run(`
      INSERT OR REPLACE INTO sdd_awbs
      SELECT
        TRIM(awb_number)                                                    AS awb_number,
        TRY_CAST(ofd_time AS TIMESTAMP)::DATE                              AS date,
        TRIM(hub)                                                           AS hub,
        REGEXP_REPLACE(TRIM(CAST(rider_id AS VARCHAR)), '\\.0$', '')        AS rider_id,
        TRIM(rider_name)                                                    AS rider_name,
        TRIM(rider_tag)                                                     AS rider_tag,
        TRIM(client_name)                                                   AS client_name,
        TRIM(latest_status)                                                 AS latest_status,
        TRY_CAST(received_at_hub_time AS TIMESTAMP)                        AS received_at_hub_time,
        TRY_CAST(ofd_time AS TIMESTAMP)                                     AS ofd_time,
        TRY_CAST(first_runsheet_time AS TIMESTAMP)                          AS first_runsheet_time,
        CASE
          WHEN LOWER(TRIM(Breach)) IN ('true','1','yes') THEN TRUE
          ELSE FALSE
        END                                                                  AS breach,
        TRIM(pod_mapping)                                                    AS pod_mapping,
        TRIM(pod_zone)                                                       AS pod_zone,
        TRY_CAST(city_id AS INTEGER)                                        AS city_id
      FROM read_csv('${filePath}', header=true, all_varchar=true)
      WHERE rider_id IS NOT NULL
        AND TRIM(rider_id) != ''
        AND ofd_time IS NOT NULL
        AND TRIM(ofd_time) != ''
    `)

    const [{ n }] = await all(`SELECT COUNT(*) AS n FROM sdd_awbs WHERE date = (
      SELECT MAX(date) FROM sdd_awbs
    )`)

    await run(`
      INSERT INTO ingest_log (filename, row_count)
      VALUES ('${filename}', ${n})
      ON CONFLICT (filename) DO UPDATE SET ingested_at = now()
    `)

    console.log(`  Done: ${filename}`)
  } catch (err) {
    console.error(`  Failed to ingest ${filename}:`, err.message)
  }
}

async function loadAllSddFiles() {
  console.log('Loading SDD CSV files...')
  const files = fs.readdirSync(SDD_DIR)
    .filter(f => f.startsWith('SDD_Data_') && f.endsWith('.csv'))
    .map(f => path.join(SDD_DIR, f))
    .sort()

  for (const f of files) {
    await loadSddFile(f)
  }

  const [{ n }] = await all(`SELECT COUNT(*) AS n FROM sdd_awbs`)
  console.log(`Total AWB records: ${n}`)
}

async function createViews() {
  console.log('Creating analytical views...')

  // max_date view — used everywhere as the analysis anchor
  await run(`CREATE OR REPLACE VIEW v_max_date AS
    SELECT MAX(date) AS max_date FROM rider_daily
  `)

  // Rider summary over configurable window (default 30 days)
  // Uses rider_daily as primary source for login classification
  await run(`CREATE OR REPLACE VIEW v_rider_summary AS
    WITH cfg AS (
      SELECT
        30  AS window_days,
        7   AS new_rider_days,
        15  AS cutoff_hour,
        80  AS evening_rider_threshold,
        70  AS cross_util_threshold,
        80  AS regular_threshold
    ),
    date_range AS (
      SELECT
        (max_date - INTERVAL (window_days - 1) DAY) AS start_date,
        max_date
      FROM v_max_date, cfg
    ),
    daily AS (
      SELECT
        rd.rider_id,
        rd.rider_name,
        rd.hub,
        rd.date,
        CASE WHEN rd.morning_runsheet_hour IS NOT NULL THEN 1 ELSE 0 END AS had_morning_login,
        CASE WHEN rd.evening_runsheet_hour IS NOT NULL THEN 1 ELSE 0 END AS had_evening_login,
        1 AS had_any_login
      FROM rider_daily rd, date_range dr
      WHERE rd.date BETWEEN dr.start_date AND dr.max_date
    ),
    agg AS (
      SELECT
        rider_id,
        MAX(rider_name)                                AS rider_name,
        MAX(hub)                                       AS hub,
        (SELECT window_days FROM cfg)                  AS total_days,
        SUM(had_any_login)                             AS login_days,
        SUM(had_morning_login)                         AS morning_login_days,
        SUM(had_evening_login)                         AS evening_login_days,
        -- True login rate: days logged in / full 30-day calendar window
        ROUND(SUM(had_any_login)   * 100.0 / (SELECT window_days FROM cfg), 1) AS login_rate_pct,
        -- Evening rate still relative to days present (behaviour, not regularity)
        ROUND(SUM(had_evening_login) * 100.0 / NULLIF(SUM(had_any_login),0), 1) AS evening_login_rate_pct,
        MIN(date)                                      AS first_login_in_window
      FROM daily
      GROUP BY rider_id
    ),
    global_first AS (
      SELECT rider_id, MIN(date) AS first_ever_login
      FROM rider_daily
      GROUP BY rider_id
    ),
    classified AS (
      SELECT
        a.*,
        gf.first_ever_login,
        (SELECT max_date FROM v_max_date) AS max_date,
        DATEDIFF('day', gf.first_ever_login, (SELECT max_date FROM v_max_date)) AS active_since_days,
        -- New Rider check
        CASE
          WHEN DATEDIFF('day', gf.first_ever_login, (SELECT max_date FROM v_max_date)) <= c.new_rider_days
          THEN TRUE ELSE FALSE
        END AS is_new_rider,
        -- Login behaviour
        CASE
          WHEN morning_login_days = 0 AND evening_login_rate_pct >= c.evening_rider_threshold
            THEN 'Evening Rider'
          WHEN morning_login_days > 0 AND evening_login_rate_pct >= c.cross_util_threshold
            THEN 'Cross Utilised'
          ELSE 'Morning Rider'
        END AS login_behaviour_tag,
        -- Regularity
        CASE
          WHEN DATEDIFF('day', gf.first_ever_login, (SELECT max_date FROM v_max_date)) <= c.new_rider_days
            THEN 'New Rider'
          WHEN login_rate_pct >= c.regular_threshold
            THEN 'Regular'
          ELSE 'Irregular'
        END AS regularity_tag
      FROM agg a
      JOIN global_first gf USING (rider_id)
      CROSS JOIN cfg c
    )
    SELECT
      c.*,
      hm.city,
      hm.zone,
      hm.pod_name
    FROM classified c
    LEFT JOIN hub_mapping hm ON c.hub = hm.hub
  `)

  // 3MR delivery metrics per rider per date
  await run(`CREATE OR REPLACE VIEW v_3mr_delivery AS
    SELECT
      a.date,
      a.hub,
      a.rider_id,
      a.rider_name,
      a.rider_tag,
      a.client_name,
      hm.city,
      hm.zone,
      CASE WHEN pc.client_name IS NOT NULL THEN TRUE ELSE FALSE END AS is_prime,
      COUNT(*) AS assigned_3mr,
      SUM(CASE WHEN a.latest_status IN ('DELIVERED','CID','NOT_CONTACTABLE') THEN 1 ELSE 0 END) AS attempted_3mr,
      SUM(CASE WHEN a.latest_status = 'DELIVERED' THEN 1 ELSE 0 END) AS delivered_3mr,
      SUM(CASE WHEN a.breach THEN 1 ELSE 0 END) AS breach_count
    FROM sdd_awbs a
    LEFT JOIN hub_mapping hm ON a.hub = hm.hub
    LEFT JOIN prime_clients pc ON LOWER(TRIM(a.client_name)) = LOWER(TRIM(pc.client_name))
    WHERE HOUR(a.received_at_hub_time) >= 15
      AND a.ofd_time IS NOT NULL
      AND a.rider_id IS NOT NULL
    GROUP BY a.date, a.hub, a.rider_id, a.rider_name, a.rider_tag, a.client_name, hm.city, hm.zone, is_prime
  `)

  console.log('Views created.')
}

async function main() {
  const forceReingest = process.argv.includes('--force')
  console.log('=== Prime Dashboard Ingest ===')
  console.log(`DB: ${DB_PATH}`)
  if (forceReingest) console.log('  --force: clearing ingest_log, will re-ingest all SDD files')
  console.log()

  try {
    await createTables()
    if (forceReingest) await run(`DELETE FROM ingest_log`)
    await loadReferenceFiles()
    await loadRawData()
    await loadAllSddFiles()
    await createViews()

    const [{ max_date }] = await all(`SELECT max_date FROM v_max_date`)
    console.log()
    console.log(`✓ Ingest complete. Max date: ${max_date}`)
  } catch (err) {
    console.error('Ingest failed:', err)
    process.exit(1)
  } finally {
    db.close()
  }
}

main()
