// DuckDB access layer — single source of truth.
//
// query<T>(sql, params)  — read path, opens read-only.
// run(sql, params)       — write path (DDL / inserts).
//
// In production a process-global singleton is reused; in development Next.js
// hot-reload would otherwise leak handles, so we stash the singleton on
// `globalThis`.
//
// SECURITY: callers MUST use ? placeholders for any value derived from
// request input. Never interpolate raw strings into SQL.

// eslint-disable-next-line @typescript-eslint/no-require-imports
const duckdb = require('duckdb') as typeof import('duckdb')
import path from 'node:path'

const DB_PATH = process.env.DUCKDB_PATH || path.join(process.cwd(), 'prime.duckdb')

type DuckDbHandle = {
  ro: { db: import('duckdb').Database; conn: import('duckdb').Connection } | null
  rw: { db: import('duckdb').Database; conn: import('duckdb').Connection } | null
}

const globalForDuck = globalThis as unknown as { __primeDuckDb?: DuckDbHandle }

function handle(): DuckDbHandle {
  if (!globalForDuck.__primeDuckDb) {
    globalForDuck.__primeDuckDb = { ro: null, rw: null }
  }
  return globalForDuck.__primeDuckDb
}

function getReadConn() {
  const h = handle()
  if (!h.ro) {
    const db = new duckdb.Database(DB_PATH, duckdb.OPEN_READONLY)
    const conn = db.connect()
    h.ro = { db, conn }
  }
  return h.ro.conn
}

function getWriteConn() {
  const h = handle()
  if (!h.rw) {
    const db = new duckdb.Database(DB_PATH)
    const conn = db.connect()
    h.rw = { db, conn }
  }
  return h.rw.conn
}

export function query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const conn = getReadConn()
    conn.all(sql, ...params, (err: Error | null, rows: unknown[]) => {
      if (err) reject(err)
      else resolve(rows as T[])
    })
  })
}

export function run(sql: string, params: unknown[] = []): Promise<void> {
  return new Promise((resolve, reject) => {
    const conn = getWriteConn()
    conn.run(sql, ...params, (err: Error | null) => {
      if (err) reject(err)
      else resolve()
    })
  })
}
