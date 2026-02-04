"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startPollingScheduler = startPollingScheduler;
const ioredis_1 = require("ioredis");
const bullmq_1 = require("bullmq");
const connection = new ioredis_1.default(process.env.REDIS_URL || 'redis://localhost:6379', { maxRetriesPerRequest: null });
const fetchQueue = new bullmq_1.Queue('fetch', { connection });
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 60 * 1000);
const POLL_SKIP_WINDOW_MS = Number(process.env.POLL_SKIP_WINDOW_MS || 30 * 1000);
function startPollingScheduler(prisma) {
    async function pollOnce() {
        try {
            const rows = await prisma.$queryRaw `
        SELECT a.id as account_id, coalesce(s.last_checked_at, to_timestamp(0)) as last_checked_at
        FROM accounts a
        LEFT JOIN mailboxes m ON m.account_id = a.id AND m.path = 'INBOX'
        LEFT JOIN sync_state s ON s.mailbox_id = m.id
        WHERE a.encrypted_credentials IS NOT NULL`;
            const now = new Date();
            for (const r of rows) {
                const accountId = r.account_id;
                const lastChecked = r.last_checked_at ? new Date(r.last_checked_at) : new Date(0);
                if ((now.getTime() - lastChecked.getTime()) >= POLL_SKIP_WINDOW_MS) {
                    try {
                        await fetchQueue.add('fetch-account', { accountId }, { removeOnComplete: true, removeOnFail: false });
                    }
                    catch (e) {
                        console.warn('[poll] failed to enqueue fetch for', accountId, e?.message || e);
                    }
                }
            }
        }
        catch (e) {
            console.warn('[poll] error during poll', e?.message || e);
        }
    }
    setInterval(pollOnce, POLL_INTERVAL_MS);
    setTimeout(pollOnce, 1000);
    console.log('[poll] polling scheduler started (interval ms=', POLL_INTERVAL_MS, ')');
}
