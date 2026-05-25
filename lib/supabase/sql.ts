import { Pool } from 'pg'

const globalForPg = globalThis as unknown as { __pgPool?: Pool }

function getPool(): Pool {
  if (!globalForPg.__pgPool) {
    globalForPg.__pgPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 5,
    })
  }
  return globalForPg.__pgPool
}

export async function query<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const pool = getPool()
  const result = await pool.query(sql, params)
  return result.rows as T[]
}
