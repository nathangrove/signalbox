import IORedis from 'ioredis';
import { Queue } from 'bullmq';

const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', { maxRetriesPerRequest: null });
const fetchQueue = new Queue('fetch', { connection });

const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 60 * 1000); // default 1 minute
const POLL_SKIP_WINDOW_MS = Number(process.env.POLL_SKIP_WINDOW_MS || 30 * 1000); // skip if last_checked_at is within this window

export function startPollingScheduler(prisma: any) {
  async function pollOnce() {
    try {
      // Pick account inboxes whose last_checked_at is null or older than the skip window
      const rows = await prisma.$queryRaw`
        SELECT a.id as account_id, coalesce(s.last_checked_at, to_timestamp(0)) as last_checked_at
        FROM accounts a
        LEFT JOIN mailboxes m ON m.account_id = a.id AND m.path = 'INBOX'
        LEFT JOIN sync_state s ON s.mailbox_id = m.id
        WHERE a.encrypted_credentials IS NOT NULL
          AND coalesce(a.sync_disabled, false) = false` as any[];

      const now = new Date();
      for (const r of rows) {
        const accountId = r.account_id;
        const lastChecked = r.last_checked_at ? new Date(r.last_checked_at) : new Date(0);
        if ((now.getTime() - lastChecked.getTime()) >= POLL_SKIP_WINDOW_MS) {
          try {
            await fetchQueue.add('fetch-account', { accountId }, { removeOnComplete: true, removeOnFail: false });
          } catch (e) {
            console.warn('[poll] failed to enqueue fetch for', accountId, (e as any)?.message || e);
          }
        }
      }
    } catch (e) {
      console.warn('[poll] error during poll', (e as any)?.message || e);
    }
  }

  setInterval(pollOnce, POLL_INTERVAL_MS);
  // run once immediately on start
  setTimeout(pollOnce, 1000);
  console.log('[poll] polling scheduler started (interval ms=', POLL_INTERVAL_MS, ')');
}
