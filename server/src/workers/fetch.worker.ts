import { Queue, WorkerOptions } from 'bullmq';
import { decryptJson, encryptJson } from '../utils/crypto';

const IORedis = require('ioredis');
const { ImapFlow } = require('imapflow');

const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', { maxRetriesPerRequest: null });

const DEFAULT_FETCH_COUNT = 20;

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
    const reason = job.data?.reason;
    console.log('fetch handler job received for accountId=', accountId);
    if (!accountId) throw new Error('accountId required');

    const account = await prisma.account.findUnique({ where: { id: accountId } });
    if (!account) throw new Error('account not found');
    if (account.syncDisabled) {
      console.log('[fetch] sync disabled for account', accountId, '- skipping');
      return { ok: true, skipped: 'sync-disabled' };
    }

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

    // Helper: compress numeric uid array into IMAP sequence-set like "1,3,5:10,12"
    function compressSeq(arr: number[]) {
      if (!arr || !arr.length) return '';
      arr.sort((a,b)=>a-b);
      const parts: string[] = [];
      let start = arr[0], last = arr[0];
      for (let i = 1; i < arr.length; i++) {
        const v = arr[i];
        if (v === last + 1) {
          last = v;
        } else {
          parts.push(start === last ? `${start}` : `${start}:${last}`);
          start = v; last = v;
        }
      }
      parts.push(start === last ? `${start}` : `${start}:${last}`);
      return parts.join(',');
    }

    // Helper: given mailboxId and an array of uids, return a Set of existing uids
    async function existingUidsSet(mailboxId: number, uids: number[]) {
      if (!uids || uids.length === 0) return new Set<number>();
      try {
        const rows = await prisma.$queryRaw`
          SELECT uid FROM messages WHERE mailbox_id = ${mailboxId} AND uid = ANY(${uids})` as any[];
        return new Set((rows || []).map((r: any) => Number(r.uid)));
      } catch (e) {
        console.warn('[fetch] existingUidsSet query failed', (e as any)?.message || e);
        return new Set<number>();
      }
    }

    const host = merged.imapHost || merged.host;
    const port = merged.port || merged.imapPort || 993;
    const secure = typeof merged.secure !== 'undefined' ? merged.secure : (typeof merged.imapSecure !== 'undefined' ? merged.imapSecure : true);
    const user = merged.imapUser || merged.user;
    let pass = merged.imapPass;

    // Build auth object. Prefer plain password when present; otherwise, if OAuth token exists, use token auth
    let authObj: any = undefined;
    if (pass && pass.length > 0) {
      authObj = { user, pass };
    } else if (merged.oauth && merged.oauth.access_token) {
      // ImapFlow expects `accessToken` on the auth object for token-based auth
      authObj = { user, accessToken: merged.oauth.access_token };
    }

    if (!host || !user || !authObj) throw new Error('missing imap credentials');

    // Debug: indicate auth type (do not print secrets)
    if ((authObj as any).accessToken) {
      console.log('[fetch] using token auth (accessToken present) for account', accountId);
    } else if ((authObj as any).pass) {
      console.log('[fetch] using password auth for account', accountId);
    } else {
      console.log('[fetch] auth object present but no pass/accessToken for account', accountId);
    }

    let client = new ImapFlow({
      host,
      port,
      secure,
      auth: authObj,
      logger: IMAP_LOGGER
    });

    // Attempt to connect; if token auth fails due to expired token, try refresh (Google) and retry once
    try {
      await client.connect();
    } catch (e: any) {
      // If auth failed and we have a refresh token, try to refresh
      if (merged.oauth && merged.oauth.refresh_token && e && e.authenticationFailed) {
        console.log('[fetch] token auth failed, attempting token refresh for account', accountId);
        try {
          const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
          const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
          if (clientId && clientSecret) {
            const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
              method: 'POST',
              headers: { 'content-type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({
                grant_type: 'refresh_token',
                refresh_token: merged.oauth.refresh_token,
                client_id: clientId,
                client_secret: clientSecret
              }).toString()
            });
            const tokenJson = await tokenRes.json();
            if (tokenJson && tokenJson.access_token) {
              merged.oauth.access_token = tokenJson.access_token;
              merged.oauth.expires_in = tokenJson.expires_in;
              merged.oauth.obtained_at = Date.now();
              // persist updated credentials
              try {
                const encrypted = encryptJson(merged);
                await prisma.account.update({ where: { id: accountId }, data: { encryptedCredentials: encrypted } });
                console.log('[fetch] refreshed and persisted new access token for account', accountId);
              } catch (updErr) {
                console.warn('[fetch] failed to persist refreshed token', accountId, (updErr as any)?.message || updErr);
              }

              // update authObj and recreate client
              authObj.accessToken = merged.oauth.access_token;
              try { await client.logout(); } catch (_) {}
              try { await client.close(); } catch (_) {}
              client = new ImapFlow({ host, port, secure, auth: authObj, logger: IMAP_LOGGER });
              await client.connect();
            } else {
              console.warn('[fetch] token refresh did not return access_token', tokenJson);
              throw e;
            }
          } else {
            console.warn('[fetch] no GOOGLE_OAUTH_CLIENT_ID/SECRET configured, cannot refresh token');
            throw e;
          }
        } catch (refreshErr) {
          console.warn('[fetch] token refresh attempt failed', (refreshErr as any)?.message || refreshErr);
          throw e;
        }
      } else {
        throw e;
      }
    }

    try {
      // queue for parse jobs
      const parseQueue = new Queue('parse', { connection });

      // Iterate selectable mailboxes and process each one. This allows full imports
      // across all folders instead of only INBOX.
      const mailboxes: any[] = [];
      try {
        // Attempt to call client.list and handle several possible return shapes:
        // - async iterable
        // - array of mailbox objects
        // - Promise that resolves to array
        if (typeof (client as any).list === 'function') {
          const res = (client as any).list('', '*');
          if (res && typeof res[Symbol.asyncIterator] === 'function') {
            for await (const m of res) {
              const path = (m && (m.path || m.name)) || String(m);
              if (m && Array.isArray(m.flags) && m.flags.includes('\\Noselect')) continue;
              mailboxes.push({ path, flags: (m && m.flags) || [] });
            }
          } else if (Array.isArray(res)) {
            for (const m of res) {
              const path = (m && (m.path || m.name)) || String(m);
              if (m && Array.isArray(m.flags) && m.flags.includes('\\Noselect')) continue;
              mailboxes.push({ path, flags: (m && m.flags) || [] });
            }
          } else if (res && typeof res.then === 'function') {
            const awaited = await res;
            if (Array.isArray(awaited)) {
              for (const m of awaited) {
                const path = (m && (m.path || m.name)) || String(m);
                if (m && Array.isArray(m.flags) && m.flags.includes('\\Noselect')) continue;
                mailboxes.push({ path, flags: (m && m.flags) || [] });
              }
            }
          }
        } else if ((client as any).mailboxes && Array.isArray((client as any).mailboxes)) {
          for (const m of (client as any).mailboxes) {
            const path = (m && (m.path || m.name)) || String(m);
            if (m && Array.isArray(m.flags) && m.flags.includes('\\Noselect')) continue;
            mailboxes.push({ path, flags: (m && m.flags) || [] });
          }
        }
      } catch (e) {
        console.warn('[fetch] mailbox list failed, defaulting to INBOX', (e as any)?.message || e);
      }
      if (mailboxes.length === 0) mailboxes.push({ path: 'INBOX', flags: [] });

      let totalEnqueued = 0;
      const forceReimport = job.data && job.data.reimport === true;
      for (const mbEntry of mailboxes) {
        const mailboxPath = mbEntry.path || 'INBOX';
        // acquire lock/select mailbox
        let lock: any = null;
        try {
          lock = await client.getMailboxLock(mailboxPath);
        } catch (err) {
          console.warn('[fetch] failed to select mailbox', mailboxPath, (err as any)?.message || err);
          continue;
        }
        try {
          const exists = client.mailbox?.exists || 0;
          if (exists < 1) continue;
          const uidNext = client.mailbox?.uidNext ? Number(client.mailbox.uidNext) : null;
          const endUid = uidNext && uidNext > 0 ? uidNext - 1 : null;

          // ensure mailbox row exists to track sync state
          const mb = await prisma.$queryRaw`
            INSERT INTO mailboxes (account_id, name, path, created_at)
            VALUES (${accountId}, ${mailboxPath}, ${mailboxPath}, now())
            ON CONFLICT (account_id, path) DO UPDATE SET name = EXCLUDED.name RETURNING id`;
          const mailboxId = (mb && mb[0] && mb[0].id) || (await prisma.$queryRaw`SELECT id FROM mailboxes WHERE account_id = ${accountId} AND path = ${mailboxPath} LIMIT 1`).then((r: any) => r && r[0] && r[0].id);

          const syncState = await prisma.$queryRaw`SELECT last_uid FROM sync_state WHERE mailbox_id = ${mailboxId} LIMIT 1` as any[];
          const lastUid = syncState && syncState[0] && syncState[0].last_uid ? Number(syncState[0].last_uid) : null;

          const newRange = lastUid && lastUid > 0 ? `${lastUid + 1}:*` : `1:${exists}`;

          console.log('[fetch] mailbox stats for account', accountId, 'mailbox', mailboxPath);

          // If requested, perform a full initial import using lookback window
          if (reason === 'initial-import') {
            // allow job to override lookback/max without restarting the worker
            const lookbackDays = job.data && typeof job.data.lookbackDays === 'number' && !Number.isNaN(job.data.lookbackDays)
              ? Number(job.data.lookbackDays)
              : Number(process.env.IMPORT_LOOKBACK_DAYS || 183);
            const maxMessages = job.data && typeof job.data.maxMessages === 'number' && !Number.isNaN(job.data.maxMessages)
              ? Number(job.data.maxMessages)
              : Number(process.env.IMPORT_MAX_MESSAGES || 10000);
            // if `full` flag is present on the job, ignore lookback and request all messages
            const sinceDate = job.data && job.data.full === true ? new Date(0) : new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

          let uids: number[] = [];
          try {
            // Request messages since `sinceDate`. Do NOT pass `uid: true` here
            // (ImapFlow will otherwise try to append it into the IMAP command)
            uids = await client.search({ since: sinceDate });
          } catch (e) {
            console.warn('[fetch] initial-import search failed, falling back to recent messages', (e as any)?.message || e);
          }

          // Some servers (Gmail) may return sequence numbers from SEARCH rather
          // than UIDs. If the returned numbers look like sequence numbers (i.e.
          // all values are <= mailbox exists count while the mailbox's UIDNEXT
          // is a large number), convert those sequence numbers to real UIDs by
          // fetching them and reading their `uid` property.
          if (uids && uids.length > 0) {
            try {
              const maxVal = Math.max(...uids);
              if (endUid && endUid > 100000 && maxVal <= (client.mailbox?.exists || 0)) {
                // likely sequence numbers; fetch them as a sequence-set to obtain UIDs
                const seqSet = compressSeq(uids as number[]);
                const seqMsgs: any[] = [];
                for await (const m of client.fetch(seqSet, { envelope: true, internalDate: true })) {
                  seqMsgs.push(m);
                }
                if (seqMsgs.length > 0) uids = seqMsgs.map(m => Number(m.uid));
              }
            } catch (convErr) {
              console.warn('[fetch] failed converting sequence numbers to UIDs', (convErr as any)?.message || convErr);
            }
          }

            if (!uids || uids.length === 0) {
            // fallback: recent messages
            const start = Math.max(1, exists - DEFAULT_FETCH_COUNT + 1);
            for await (const msg of client.fetch(`${start}:${exists}`, { envelope: true, internalDate: true }, { uid: true })) {
              uids.push(msg.uid as number);
            }
          }

          if (!uids || uids.length === 0) {
            console.log('[fetch] initial-import: no messages found for requested window');
          } else {
            if (uids.length > maxMessages) uids = uids.slice(uids.length - maxMessages);
            const CHUNK_UIDS = 200;
            let enqueued = 0;
            for (let i = 0; i < uids.length; i += CHUNK_UIDS) {
              const chunk = uids.slice(i, i + CHUNK_UIDS);
              const seq = compressSeq(chunk);
              const msgs: any[] = [];
              for await (const msg of client.fetch(seq, { envelope: true, internalDate: true }, { uid: true })) {
                msgs.push(msg);
              }
              const uidsChunk = msgs.map(m => Number(m.uid));
              const existing = await existingUidsSet(mailboxId, uidsChunk);
              for (const msg of msgs) {
                if (!forceReimport && existing.has(Number(msg.uid))) continue;
                await parseQueue.add('parse-message', {
                  accountId,
                  mailbox: mailboxPath,
                  uid: msg.uid,
                }, { jobId: `${mailboxId}-${msg.uid}`, removeOnComplete: true });
                enqueued += 1;
                totalEnqueued += 1;
                if (totalEnqueued >= maxMessages) break;
              }
              if (totalEnqueued >= maxMessages) break;
            }
            console.log('[fetch] initial-import enqueued', enqueued, 'parse job(s) for mailbox', mailboxPath, 'account', accountId);
          }
          // if we've reached global max, stop processing further mailboxes
          if (reason === 'initial-import' && totalEnqueued >= (job.data && job.data.maxMessages ? Number(job.data.maxMessages) : Number(process.env.IMPORT_MAX_MESSAGES || 10000))) {
            try { lock.release(); } catch (_) {}
            break;
          }
          // continue to next mailbox
          continue;
        }

        // Backfill window to catch any missing UIDs below lastUid
        const backfillEnd = endUid || exists;
        const backfillStart = Math.max(1, backfillEnd - 200 + 1);
        const backfillUpper = lastUid && lastUid > 0 ? Math.min(lastUid, backfillEnd) : 0;

          if (backfillUpper >= backfillStart) {
          const existingRows = await prisma.$queryRaw `
            SELECT uid FROM messages
            WHERE mailbox_id = ${mailboxId} AND uid BETWEEN ${backfillStart} AND ${backfillUpper}`;
          const existingSet = new Set((existingRows || []).map((r: any) => Number(r.uid)));
          const backfillRange = `${backfillStart}:${backfillUpper}`;
          try {
            for await (const msg of client.fetch(backfillRange, { envelope: true, internalDate: true }, { uid: true })) {
              if (!forceReimport && existingSet.has(Number(msg.uid))) continue;
              await parseQueue.add('parse-message', {
                accountId,
                mailbox: mailboxPath,
                uid: msg.uid,
                seq: msg.seq,
                envelope: msg.envelope,
                internalDate: msg.internalDate,
              }, { jobId: `${mailboxId}-${msg.uid}`, removeOnComplete: true });
            }
          } catch (e) {
            console.warn(`[fetch] backfillRange ${backfillRange} failed: ${(e as any)?.message || e}`);
            if ((e && (e.responseText || '').includes('Invalid messageset')) || /Invalid messageset/.test((e as any)?.message || '')) {
              const chunkSize = 1000;
              for (let s = backfillStart; s <= backfillUpper; s += chunkSize) {
                const eEnd = Math.min(backfillUpper, s + chunkSize - 1);
                const subRange = `${s}:${eEnd}`;
                console.log(`[fetch] retrying backfill subrange ${subRange}`);
                for await (const msg of client.fetch(subRange, { envelope: true, internalDate: true }, { uid: true })) {
                  if (!forceReimport && existingSet.has(Number(msg.uid))) continue;
                  await parseQueue.add('parse-message', {
                    accountId,
                    mailbox: mailboxPath,
                    uid: msg.uid,
                    seq: msg.seq,
                    envelope: msg.envelope,
                    internalDate: msg.internalDate,
                  }, { jobId: `${mailboxId}-${msg.uid}`, removeOnComplete: true });
                }
              }
            } else {
              throw e;
            }
          }
        }

        try {
          // Fetch in chunks and avoid enqueueing parse jobs we already have stored.
          const CHUNK_UIDS = 200;
          let buffer: any[] = [];
          async function flushBuffer() {
            if (!buffer.length) return;
            const uidsChunk = buffer.map((m: any) => Number(m.uid));
            const existing = await existingUidsSet(mailboxId, uidsChunk);
            for (const msg of buffer) {
              if (!forceReimport && existing.has(Number(msg.uid))) continue;
                await parseQueue.add('parse-message', {
                  accountId,
                  mailbox: mailboxPath,
                  uid: msg.uid,
                  seq: msg.seq,
                  envelope: msg.envelope,
                  internalDate: msg.internalDate,
                }, { jobId: `${mailboxId}-${msg.uid}`, removeOnComplete: true });
            }
            buffer = [];
          }

          for await (const msg of client.fetch(newRange, { envelope: true, internalDate: true }, { uid: true })) {
            buffer.push(msg);
            if (buffer.length >= CHUNK_UIDS) await flushBuffer();
          }
          await flushBuffer();
        } catch (e) {
          console.warn(`[fetch] newRange ${newRange} failed: ${(e as any)?.message || e}`);
          if ((e && (e.responseText || '').includes('Invalid messageset')) || /Invalid messageset/.test((e as any)?.message || '')) {
            let start = 1;
            const match = /^([0-9]+):/.exec(newRange);
            if (match) start = Number(match[1]);
            const end = endUid || exists;
            const chunkSize = 1000;
            for (let s = start; s <= end; s += chunkSize) {
              const eEnd = Math.min(end, s + chunkSize - 1);
              const subRange = `${s}:${eEnd}`;
              console.log(`[fetch] retrying new subrange ${subRange}`);
              // For subranges, also chunk and skip already-stored UIDs
              let sbuf: any[] = [];
              async function sflush() {
                if (!sbuf.length) return;
                const uidsChunk = sbuf.map((m: any) => Number(m.uid));
                const existing = await existingUidsSet(mailboxId, uidsChunk);
                for (const msg of sbuf) {
                  if (!forceReimport && existing.has(Number(msg.uid))) continue;
                  await parseQueue.add('parse-message', {
                    accountId,
                    mailbox: mailboxPath,
                    uid: msg.uid,
                    seq: msg.seq,
                    envelope: msg.envelope,
                    internalDate: msg.internalDate,
                  }, { removeOnComplete: true, removeOnFail: false });
                }
                sbuf = [];
              }
              for await (const msg of client.fetch(subRange, { envelope: true, internalDate: true }, { uid: true })) {
                sbuf.push(msg);
                if (sbuf.length >= 200) await sflush();
              }
              await sflush();
            }
          } else {
            throw e;
          }
        }
        } finally {
          try { lock.release(); } catch (_) {}
        }
      }
    } finally {
      try { await client.logout(); } catch (_) {}
    }
  };
}
