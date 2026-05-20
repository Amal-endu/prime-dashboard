// DuckDB — creates a fresh read-only connection per query
// Turbopack re-initialises modules on each request, so we can't cache
const duckdb = require('duckdb')
const path = require('path')

// Use process.cwd() so the path resolves correctly when run via Next.js webpack
const DB_PATH = process.env.DUCKDB_PATH || path.join(process.cwd(), 'prime.duckdb')

function getDb() {
  const db = new duckdb.Database(DB_PATH, duckdb.OPEN_READONLY)
  const conn = db.connect()
  return { db, conn }
}

// Promise wrapper for DuckDB all()
function query(sql, params = []) {
  return new Promise((resolve, reject) => {
    // Open fresh DB + connection for each query
    const db = new duckdb.Database(DB_PATH, duckdb.OPEN_READONLY)
    const conn = db.connect()
    conn.all(sql, ...params, (err, rows) => {
      // Close after result is ready
      try { conn.close() } catch (_) {}
      try { db.close() } catch (_) {}
      if (err) reject(err)
      else resolve(rows)
    })
  })
}

// Promise wrapper for DuckDB run() — for DDL/inserts (write mode)
function run(sql) {
  return new Promise((resolve, reject) => {
    const db = new duckdb.Database(DB_PATH)
    const conn = db.connect()
    conn.run(sql, (err) => {
      try { conn.close() } catch (_) {}
      try { db.close() } catch (_) {}
      if (err) reject(err)
      else resolve()
    })
  })
}

module.exports = { getDb, query, run }
