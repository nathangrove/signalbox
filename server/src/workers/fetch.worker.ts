import { Queue, WorkerOptions } from 'bullmq';
import { decryptJson } from '../utils/crypto';

const IORedis = require('ioredis');
const { ImapFlow } = require('imapflow');

const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', { maxRetriesPerRequest: null });

// Toggle verbose IMAP/imapflow protocol logs with IMAP_DEBUG=true. Default is silent.
const IMAP_DEBUG = (process.env.IMAP_DEBUG || 'false') === 'true';
const IMAP_LOGGER = IMAP_DEBUG ? console : { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

export const fetchWorkerOptions: Partial<WorkerOptions> = {
  concurrency: Number(process.env.FETCH_CONCURRENCY || 1),
  // IMAP fetches can be slow; keep the lock long enough to avoid false stalls
  lockDuration: Number(process.env.FETCH_LOCK_DURATION_MS || 10 * 60 * 1000),
  stalledInterval: Number(process.env.FETCH_STALLED_INTERVAL_MS || 30 * 1000),
  maxStalledCount: Number(process.env.FETCH_MAX_STALLED_COUNT || 3)
};

export function createFetchWorkerHandler(prisma: any) {
  return async (job: any) => {
    const { accountId } = job.data || {};
    console.log('fetch handler job received for accountId=', accountId);
    if (!accountId) throw new Error('accountId required');

    const account = await prisma.account.findUnique({ where: { id: accountId } });
    console.log('prisma returned account=', !!account);
    if (!account) throw new Error('account not found');

    // Decrypt stored credentials; fall back to account.config if present (handle older/partial records)
    let creds: any = {};
    try {
      if (account.encryptedCredentials && account.encryptedCredentials.length) {
        creds = decryptJson(account.encryptedCredentials) || {};
      }
    } catch (e) {
      creds = {};
    }
    const cfgFallback = account.config || {};
    const merged = Object.assign({}, cfgFallback, creds);

    const host = merged.imapHost;
    const port = merged.port || merged.imapPort || 993;
    const secure = typeof merged.secure !== 'undefined' ? merged.secure : (typeof merged.imapSecure !== 'undefined' ? merged.imapSecure : true);
    const user = merged.imapUser;
    const pass = merged.imapPass;

    if (!host || !user || !pass) throw new Error('missing imap credentials');

    const client = new ImapFlow({
      host,
      port,
      secure,
      auth: { user, pass },
      logger: IMAP_LOGGER
    });

    await client.connect();
    try {
      // queue for parse jobs
      const parseQueue = new Queue('parse', { connection });

      // Open INBOX and fetch only messages we have not ingested yet
      const lock = await client.getMailboxLock('INBOX');
      try {
        const exists = client.mailbox?.exists || 0;
        if (exists < 1) return;
        const uidNext = client.mailbox?.uidNext ? Number(client.mailbox.uidNext) : null;
        const endUid = uidNext && uidNext > 0 ? uidNext - 1 : null;

        // ensure mailbox row exists to track sync state
        const mb = await prisma.$queryRaw`
          INSERT INTO mailboxes (account_id, name, path, created_at)
          VALUES (${accountId}, 'INBOX', 'INBOX', now())
          ON CONFLICT (account_id, path) DO UPDATE SET name = EXCLUDED.name RETURNING id`;
        const mailboxId = (mb && mb[0] && mb[0].id) || (await prisma.$queryRaw`SELECT id FROM mailboxes WHERE account_id = ${accountId} AND path = 'INBOX' LIMIT 1`).then((r: any) => r && r[0] && r[0].id);

        const syncState = await prisma.$queryRaw`SELECT last_uid FROM sync_state WHERE mailbox_id = ${mailboxId} LIMIT 1` as any[];
        const lastUid = syncState && syncState[0] && syncState[0].last_uid ? Number(syncState[0].last_uid) : null;

        const newRange = lastUid && lastUid > 0 ? `${lastUid + 1}:*` : `1:${exists}`;

        // Backfill window to catch any missing UIDs below lastUid
        const backfillEnd = endUid || exists;
        const backfillStart = Math.max(1, backfillEnd - 200 + 1);
        const backfillUpper = lastUid && lastUid > 0 ? Math.min(lastUid, backfillEnd) : 0;

        if (backfillUpper >= backfillStart) {
          const existingRows = await prisma.$queryRaw`
            SELECT uid FROM messages
            WHERE mailbox_id = ${mailboxId} AND uid BETWEEN ${backfillStart} AND ${backfillUpper}` as any[];
          const existingSet = new Set((existingRows || []).map(r => Number(r.uid)));
          const backfillRange = `${backfillStart}:${backfillUpper}`;

          try {
            for await (const msg of client.fetch(backfillRange, { envelope: true, internalDate: true }, { uid: true })) {
              if (existingSet.has(Number(msg.uid))) continue;
              await parseQueue.add('parse-message', {
                accountId,
                mailbox: 'INBOX',
                uid: msg.uid,
                seq: msg.seq,
                envelope: msg.envelope,
                internalDate: msg.internalDate,
              }, { removeOnComplete: true, removeOnFail: false });
            }
          } catch (e: any) {
            console.warn(`[fetch] backfillRange ${backfillRange} failed: ${e?.message || e}`);
            if ((e && (e.responseText || '').includes('Invalid messageset')) || /Invalid messageset/.test(e?.message || '')) {
              // Split into smaller chunks and retry
              const chunkSize = 1000;
              for (let s = backfillStart; s <= backfillUpper; s += chunkSize) {
                const eEnd = Math.min(backfillUpper, s + chunkSize - 1);
                const subRange = `${s}:${eEnd}`;
                console.log(`[fetch] retrying backfill subrange ${subRange}`);
                for await (const msg of client.fetch(subRange, { envelope: true, internalDate: true }, { uid: true })) {
                  if (existingSet.has(Number(msg.uid))) continue;
                  await parseQueue.add('parse-message', {
                    accountId,
                    mailbox: 'INBOX',
                    uid: msg.uid,
                    seq: msg.seq,
                    envelope: msg.envelope,
                    internalDate: msg.internalDate,
                  }, { removeOnComplete: true, removeOnFail: false });
                }
              }
            } else {
              throw e;
            }
          }
        }

        try {
          for await (const msg of client.fetch(newRange, { envelope: true, internalDate: true }, { uid: true })) {
            await parseQueue.add('parse-message', {
              accountId,
              mailbox: 'INBOX',
              uid: msg.uid,
              seq: msg.seq,
              envelope: msg.envelope,
              internalDate: msg.internalDate,
            }, { removeOnComplete: true, removeOnFail: false });
          }
        } catch (e: any) {
          console.warn(`[fetch] newRange ${newRange} failed: ${e?.message || e}`);
          if ((e && (e.responseText || '').includes('Invalid messageset')) || /Invalid messageset/.test(e?.message || '')) {
            // fallback: split into manageable chunks from start to computed end
            let start = 1;
            const match = /^([0-9]+):/.exec(newRange);
            if (match) start = Number(match[1]);
            const end = endUid || exists;
            const chunkSize = 1000;
            for (let s = start; s <= end; s += chunkSize) {
              const eEnd = Math.min(end, s + chunkSize - 1);
              const subRange = `${s}:${eEnd}`;
              console.log(`[fetch] retrying new subrange ${subRange}`);
              for await (const msg of client.fetch(subRange, { envelope: true, internalDate: true }, { uid: true })) {
                await parseQueue.add('parse-message', {
                  accountId,
                  mailbox: 'INBOX',
                  uid: msg.uid,
                  seq: msg.seq,
                  envelope: msg.envelope,
                  internalDate: msg.internalDate,
                }, { removeOnComplete: true, removeOnFail: false });
              }
            }
          } else {
            throw e;
          }
        }
      } finally {
        lock.release();
      }
    } finally {
      await client.logout();
    }
  };
}
