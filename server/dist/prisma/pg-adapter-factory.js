"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createLocalPgAdapterFactory = createLocalPgAdapterFactory;
const pg_1 = require("pg");
function createLocalPgAdapterFactory(connectionString) {
    return {
        provider: 'postgresql',
        adapterName: 'local-pg-adapter',
        async connect() {
            const pool = new pg_1.Pool({ connectionString });
            const executeRaw = async ({ sql, args }) => {
                const client = await pool.connect();
                try {
                    const res = await client.query(sql, args || []);
                    return res;
                }
                finally {
                    client.release();
                }
            };
            return {
                executeRaw: async ({ sql, args }) => {
                    return executeRaw({ sql, args });
                },
                query: async (sql, params) => {
                    const client = await pool.connect();
                    try {
                        const res = await client.query(sql, params || []);
                        return { rows: res.rows, columnNames: res.fields.map((f) => f.name), columnTypes: [] };
                    }
                    finally {
                        client.release();
                    }
                },
                executeScript: async (script) => {
                    const statements = script.split(';').map(s => s.trim()).filter(Boolean);
                    for (const stmt of statements) {
                        await executeRaw({ sql: stmt });
                    }
                },
                getConnectionInfo: () => ({ supportsRelationJoins: true }),
                dispose: async () => {
                    await pool.end();
                },
                underlyingDriver: () => pool,
            };
        },
    };
}
