// TypeScript wrapper — delegates to CommonJS db.js
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { query: _query, run: _run } = require('./db.js')

export function query(sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
  return _query(sql, params)
}

export function run(sql: string): Promise<void> {
  return _run(sql)
}
