import { Pool } from 'pg'

type Adapter = any

export function createLocalPgAdapterFactory(connectionString: string) {
  return {
    provider: 'postgresql',
    adapterName: 'local-pg-adapter',
    async connect() {
      const pool = new Pool({ connectionString })

      const executeRaw = async ({ sql, args }: { sql: string; args?: any[] }) => {
        const client = await pool.connect()
        try {
          const res = await client.query(sql, args || [])
          return res
        } finally {
          client.release()
        }
      }

      return {
        executeRaw: async ({ sql, args }: { sql: string; args?: any[] }) => {
          return executeRaw({ sql, args })
        },
        query: async (sql: string, params: any[]) => {
          const client = await pool.connect()
          try {
            const res = await client.query(sql, params || [])
            return { rows: res.rows, columnNames: res.fields.map((f: any) => f.name), columnTypes: [] }
          } finally {
            client.release()
          }
        },
        executeScript: async (script: string) => {
          const statements = script.split(';').map(s => s.trim()).filter(Boolean)
          for (const stmt of statements) {
            await executeRaw({ sql: stmt })
          }
        },
        getConnectionInfo: () => ({ supportsRelationJoins: true }),
        dispose: async () => {
          await pool.end()
        },
        underlyingDriver: () => pool,
      } as Adapter
    },
  }
}
