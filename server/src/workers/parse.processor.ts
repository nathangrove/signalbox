import { Queue, WorkerOptions } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { ImapFlow } from 'imapflow';
import { decryptJson } from '../utils/crypto';
import { simpleParser } from 'mailparser';
import * as crypto from 'crypto';
import { Readable } from 'stream';
import { publishNotification } from '../notifications/redis-pub';
const IORedis = require('ioredis');

// Job processor exported as a function compatible with BullMQ Worker

// Pool IMAP clients per account to limit concurrent connections
const imapClientPool: Map<string, ImapFlow[]> = new Map();
const MAX_CLIENTS_PER_ACCOUNT = 5;

const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', { maxRetriesPerRequest: null });
const aiQueue = new Queue('ai', { connection });

async function doFetch(client: ImapFlow, seq: string, uid: number, accountId: string, mailboxId: string, prisma: any, job: any) {
  for await (const msg of client.fetch(seq, { source: true, envelope: true, internalDate: true, size: true, flags: true })) {
    // normal path
    
    const rawBuf: Buffer = msg.source as Buffer;
    const envelope = msg.envelope || {};
    const internalDate = msg.internalDate ? new Date(msg.internalDate) : new Date();
    const size = msg.size ? Number(msg.size) : rawBuf.length;
    const flags = msg.flags || [];
    const messageId = envelope.messageId || null;

    // parse to extract attachments metadata and headers
    const parsed = await simpleParser(Readable.from(rawBuf));

    // Upsert message row using raw SQL to match migration layout
    const inserted = await prisma.$queryRaw`
      INSERT INTO messages (account_id, mailbox_id, uid, uid_validity, message_id, subject, from_header, to_header, cc_header, internal_date, size_bytes, flags, raw, created_at, updated_at)
      VALUES (
        ${accountId}, ${mailboxId}, ${uid}, NULL, ${messageId}, ${parsed.subject ?? null}, ${JSON.stringify((parsed.from as any)?.value ?? null)}, ${JSON.stringify((parsed.to as any)?.value ?? null)}, ${JSON.stringify((parsed.cc as any)?.value ?? null)}, ${internalDate}, ${size}, ${flags}, ${rawBuf}, now(), now()
      )
      ON CONFLICT (mailbox_id, uid) DO UPDATE SET subject = EXCLUDED.subject, updated_at = now(), raw = EXCLUDED.raw
      RETURNING id, (xmax = 0) AS inserted`;

    const messageIdRow = (inserted && inserted[0] && inserted[0].id) || null;
    const isInserted = Boolean(inserted && inserted[0] && inserted[0].inserted);

    if (messageIdRow) {
      await prisma.$queryRaw`
        INSERT INTO sync_state (mailbox_id, last_uid, last_checked_at)
        VALUES (${mailboxId}, ${uid}, now())
        ON CONFLICT (mailbox_id) DO UPDATE
        SET last_uid = GREATEST(sync_state.last_uid, EXCLUDED.last_uid), last_checked_at = now()`;
    }

    // create initial message_versions entry
    if (messageIdRow && isInserted) {

      await prisma.$queryRaw`
        INSERT INTO message_versions (message_id, version, raw, reason, created_by, created_at)
        VALUES (${messageIdRow}, 1, ${rawBuf}, 'initial', 'parser', now())
        ON CONFLICT (message_id, version) DO NOTHING`;

      // attachments
      const attachments = parsed.attachments || [];
      for (const at of attachments) {
        const sha = crypto.createHash('sha256').update(at.content).digest();
        await prisma.$queryRaw`
          INSERT INTO attachments (message_id, filename, content_type, size_bytes, content_id, sha256, stored_path, created_at)
          VALUES (${messageIdRow}, ${at.filename ?? null}, ${at.contentType ?? null}, ${at.size ?? at.content.length}, ${at.cid ?? null}, ${sha}, NULL, now())`;
      }

      // enqueue an embeddings/ai job for this message
      // mark ai_metadata row so downstream ai worker can pick it up
      const insertedAi = await prisma.$queryRaw`
        INSERT INTO ai_metadata (message_id, model, provider, created_at)
        VALUES (${messageIdRow}, 'pending', 'local', now())
        ON CONFLICT (message_id, version) DO NOTHING
        RETURNING id` as any[];

      const aiRows = await prisma.$queryRaw`
        SELECT id FROM ai_metadata WHERE message_id = ${messageIdRow} AND version = 1 LIMIT 1` as any[];
      const aiMetadataId = (insertedAi && insertedAi[0] && insertedAi[0].id) || (aiRows && aiRows[0] && aiRows[0].id);

      if (aiMetadataId) {
        // Parse calendar attachments (RFC 5545) if present and insert into events table
        try {
          const icsList: string[] = []
          // check attachments for text/calendar or .ics
          for (const at of attachments) {
            const ctype = (at.contentType || '').toLowerCase()
            const fname = (at.filename || '').toLowerCase()
            if (ctype === 'text/calendar' || fname.endsWith('.ics')) {
              try {
                const text = at.content ? at.content.toString('utf8') : ''
                if (text.includes('BEGIN:VCALENDAR')) icsList.push(text)
              } catch (_) {}
            }
          }
          // Also check parsed text/html for embedded iCalendar data
          if (parsed && parsed.text && parsed.text.includes('BEGIN:VCALENDAR')) {
            icsList.push(parsed.text)
          }

          function parseIcs(ics: string) {
            const events: any[] = []
            const veventMatches = ics.split(/BEGIN:VCALENDAR/i).slice(1).join('BEGIN:VCALENDAR').match(/BEGIN:V?VEVENT[\s\S]*?END:V?VEVENT/gi) || []
            for (const v of veventMatches) {
              const get = (k: string) => {
                const re = new RegExp(k + ':(.*?)\r?\n', 'i')
                const m = v.match(re)
                return m ? m[1].trim() : null
              }
              const summary = get('SUMMARY')
              const location = get('LOCATION')
              const dtstart = get('DTSTART')
              const dtend = get('DTEND')
              const attendeesRaw = Array.from((v.match(/ATTENDEE[:;].*?CN=([^;\r\n]*)/gi) || [])).map(s => s.replace(/ATTENDEE[:;].*?CN=/i, ''))
              const attendees = attendeesRaw.length ? attendeesRaw : null
              let startTs = null
              let endTs = null
              try {
                if (dtstart) startTs = new Date(dtstart)
                if (dtend) endTs = new Date(dtend)
              } catch (_) {}
              events.push({ summary, location, startTs, endTs, attendees })
            }
            return events
          }

          for (const ics of icsList) {
            const evs = parseIcs(ics)
            for (const ev of evs) {
              try {
                await prisma.$queryRaw`
                  INSERT INTO events (message_id, ai_metadata_id, start_ts, end_ts, summary, location, attendees, source, created_at)
                  VALUES (${messageIdRow}, ${aiMetadataId}, ${ev.startTs}, ${ev.endTs}, ${ev.summary}, ${ev.location}, ${JSON.stringify(ev.attendees ?? {})}::jsonb, 'ical', now())`;
              } catch (e) {
                console.warn('failed to insert event from ics', (e as any)?.message || e)
              }
            }
          }
        } catch (e) {
          console.warn('error parsing ics attachments', (e as any)?.message || e)
        }

        // simple heuristic: look for tracking URLs or tracking-like strings in the text and update ai_metadata.tracking
        try {
          const trackingItems: any[] = []
          const textForScan = (parsed && (parsed.text || parsed.html || '')) || ''

          function tryParseDateFromSnippet(s: string): string | null {
            if (!s) return null
            // common phrases that precede dates
            const datePhrases = /(estimated delivery|expected delivery|delivery date|delivered on|arrives on|delivery expected|expected arrival)[:\s]*([^\n\r<]+)/i
            const m = s.match(datePhrases)
            if (m && m[2]) {
              const cand = m[2].trim().replace(/<[^>]*>/g, '')
              const d = Date.parse(cand)
              if (!Number.isNaN(d)) return new Date(d).toISOString()
            }

            // fallback: look for ISO or common date formats in the snippet
            const dateRe = /(\d{4}-\d{2}-\d{2})|(\d{1,2}\/\d{1,2}\/\d{2,4})|([A-Za-z]{3,9} \d{1,2},? \d{4})/g
            const found = s.match(dateRe)
            if (found && found.length) {
              for (const f of found) {
                const d = Date.parse(f)
                if (!Number.isNaN(d)) return new Date(d).toISOString()
              }
            }

            return null
          }

          if (textForScan) {
            const urlRe = /https?:\/\/[\w\-./?&=%#]+/gi
            const urls = Array.from(new Set((textForScan.match(urlRe) || [])))
            for (const u of urls) {
              const ul = String(u).toLowerCase()
              // capture snippet around the url to look for delivery dates
              const idx = textForScan.indexOf(u)
              const snippet = idx >= 0 ? textForScan.slice(Math.max(0, idx - 200), Math.min(textForScan.length, idx + 200)) : ''
              const delivery = tryParseDateFromSnippet(snippet)

              if (ul.includes('track') || ul.includes('tracking') || ul.includes('/t/')) {
                trackingItems.push({ carrier: 'unknown', trackingNumber: null, url: u, status: null, deliveryDate: delivery })
              }
              if (ul.includes('ups.com') || ul.includes('1z')) {
                trackingItems.push({ carrier: 'UPS', trackingNumber: null, url: u, status: null, deliveryDate: delivery })
              }
              if (ul.includes('fedex.com')) trackingItems.push({ carrier: 'FEDEX', trackingNumber: null, url: u, status: null, deliveryDate: delivery })
              if (ul.includes('usps.com') || ul.includes('usps')) trackingItems.push({ carrier: 'USPS', trackingNumber: null, url: u, status: null, deliveryDate: delivery })
            }

            // bare tracking numbers heuristics
            const trackingRe = /(1Z[0-9A-Z]{16})|([0-9]{12,22})/g
            const found = Array.from(new Set(((textForScan.match(trackingRe) as string[]) || [])))
            for (const f of found) {
              const clean = String(f).trim()
              // ignore dates (simple): if contains - or / skip
              if (/[\/\-]/.test(clean)) continue
              // locate clean in text and attempt to parse nearby delivery date
              const idx = textForScan.indexOf(clean)
              const snippet = idx >= 0 ? textForScan.slice(Math.max(0, idx - 200), Math.min(textForScan.length, idx + 200)) : ''
              const delivery = tryParseDateFromSnippet(snippet)
              // trackingItems.push({ carrier: 'UNKNOWN', trackingNumber: clean, url: null, status: null, deliveryDate: delivery })
            }
          }

          if (trackingItems.length) {
            await prisma.$queryRaw`
              UPDATE ai_metadata
              SET tracking = ${JSON.stringify(trackingItems)}::jsonb
              WHERE id = ${aiMetadataId}`;
          }
        } catch (e) {
          console.warn('error extracting tracking heuristics', (e as any)?.message || e)
        }

        await aiQueue.add('classify-message', { messageId: messageIdRow, aiMetadataId }, { attempts: 3, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: true, removeOnFail: false });
      }
    }

    // Publish a notification for the user so connected clients can update in real-time
    try {
      const acct = await prisma.account.findUnique({ where: { id: accountId }, select: { userId: true } as any });
      const userId = (acct && (acct as any).userId) || null;
      if (userId && messageIdRow) {
        await publishNotification({ type: 'message.created', userId, mailboxId, messageId: messageIdRow, subject: parsed.subject || null, from: (parsed.from as any)?.value?.[0] || null, internalDate: internalDate.toISOString() });
      }
    } catch (e) {
      console.warn('publish notification failed', (e as any)?.message || e);
    }

    console.log(`Parsed and stored message uid=${uid} (message_id=${messageIdRow})`);
  }
}

export const parseJobProcessor = async (job: any) => {
  const prisma = new PrismaService();
  let client: ImapFlow | undefined;
  let accountId = '';
  let mailbox: string;
  let uid: number;
  try {
    ({ accountId, mailbox = 'INBOX', uid } = job.data as { accountId: string; mailbox?: string; uid: number });

    if (!accountId || !uid) throw new Error('Missing accountId or uid');

    // Fetch account and credentials/config
    const account = await prisma.account.findUnique({ where: { id: accountId } });
    if (!account) throw new Error(`Account ${accountId} not found`);

    let cfg: any = account.config || {};
    // prefer encryptedCredentials when config is empty or missing IMAP-specific fields
    if ((!cfg.imapHost || !cfg.imapUser || !cfg.imapPass) && account.encryptedCredentials && account.encryptedCredentials.length) {
      try {
        cfg = decryptJson(account.encryptedCredentials);
      } catch (e) {
        console.error('failed to decrypt account credentials for parse processor', account.id, (e as any)?.message);
      }
    }

    // Toggle verbose IMAP/imapflow protocol logs with IMAP_DEBUG=true. Default is silent.
    const IMAP_DEBUG = (process.env.IMAP_DEBUG || 'false') === 'true';
    const IMAP_LOGGER = IMAP_DEBUG ? console : { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

    // allow storing raw connection fields in config for the scaffold
    const imapCfg = {
      host: cfg.imapHost,
      port: cfg.imapPort ?? 993,
      secure: typeof cfg.imapSecure !== 'undefined' ? cfg.imapSecure : true,
      auth: cfg.auth || { user: cfg.imapUser || account.email, pass: cfg.imapPass }
    };

    // get or create client from pool, limiting to MAX_CLIENTS_PER_ACCOUNT
    let pool = imapClientPool.get(accountId) || [];
    if (pool.length >= MAX_CLIENTS_PER_ACCOUNT) {
      throw new Error(`Too many concurrent IMAP connections for account ${accountId} (${pool.length}/${MAX_CLIENTS_PER_ACCOUNT})`);
    }

    client = new ImapFlow({
      host: imapCfg.host,
      port: imapCfg.port,
      secure: imapCfg.secure,
      auth: imapCfg.auth,
      // reduce aggressive timeouts so hung connections don't pile up
      socketTimeout: 30000,
      logger: IMAP_LOGGER
    });

    pool.push(client);
    imapClientPool.set(accountId, pool);

    try {
      await client.connect();
    } catch (e) {
      // remove from pool on connect failure
      const idx = pool.indexOf(client);
      if (idx > -1) pool.splice(idx, 1);
      imapClientPool.set(accountId, pool);
      throw e;
    }

    // ensure mailbox record exists
    const mb = await prisma.$queryRaw`
      INSERT INTO mailboxes (account_id, name, path, created_at)
      VALUES (${accountId}, ${mailbox}, ${mailbox}, now())
      ON CONFLICT (account_id, path) DO UPDATE SET name = EXCLUDED.name RETURNING id`;

    const mailboxRow = mb as any[];
    const mailboxFallback = await prisma.$queryRaw`SELECT id FROM mailboxes WHERE account_id = ${accountId} AND path = ${mailbox} LIMIT 1` as any[];
    const mailboxId = (mailboxRow && mailboxRow[0] && mailboxRow[0].id) || (mailboxFallback && mailboxFallback[0] && mailboxFallback[0].id);

    // Skip reprocessing if we already have the full raw message stored
    const existing = await prisma.$queryRaw`
      SELECT id, raw FROM messages WHERE mailbox_id = ${mailboxId} AND uid = ${uid} LIMIT 1` as any[];
    if (existing && existing[0] && existing[0].raw) {
      await prisma.$queryRaw`
        INSERT INTO sync_state (mailbox_id, last_uid, last_checked_at)
        VALUES (${mailboxId}, ${uid}, now())
        ON CONFLICT (mailbox_id) DO UPDATE
        SET last_uid = GREATEST(sync_state.last_uid, EXCLUDED.last_uid), last_checked_at = now()`;
      console.log(`Skipping parse for existing message uid=${uid} (message_id=${existing[0].id})`);
      return { ok: true, skipped: true };
    }

    const lock = await client.getMailboxLock(mailbox);
    try {
      // fetch full RFC822 source and metadata
      // prefer sequence number from the producer (safer); fall back to uid
      const seq = job.data && job.data.seq ? String(job.data.seq) : String(uid);
      await doFetch(client, seq, uid, accountId, mailboxId, prisma, job);
    } finally {
      lock.release();
    }
    return { ok: true };
  } catch (err) {
    console.error('parseJobProcessor error', err);
    throw err;
  } finally {
    try {
      if (client && accountId) {
        await client.logout();
        const pool = imapClientPool.get(accountId) || [];
        const idx = pool.indexOf(client);
        if (idx > -1) pool.splice(idx, 1);
        imapClientPool.set(accountId, pool);
      }
    } catch (e) {
      console.warn('Error logging out IMAP client', (e as any)?.message);
    }
    try {
      await prisma.$disconnect();
    } catch (_) {}
  }
};

// Provide a WorkerOptions compatible export for requiring directly
export const parseWorkerOptions: Partial<WorkerOptions> = { concurrency: 3 };

export default parseJobProcessor;
