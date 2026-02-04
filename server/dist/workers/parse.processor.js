"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseWorkerOptions = exports.parseJobProcessor = void 0;
const bullmq_1 = require("bullmq");
const prisma_service_1 = require("../prisma/prisma.service");
const imapflow_1 = require("imapflow");
const crypto_1 = require("../utils/crypto");
const mailparser_1 = require("mailparser");
const crypto = require("crypto");
const stream_1 = require("stream");
const redis_pub_1 = require("../notifications/redis-pub");
const IORedis = require('ioredis');
const imapClientPool = new Map();
const MAX_CLIENTS_PER_ACCOUNT = 5;
const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', { maxRetriesPerRequest: null });
const aiQueue = new bullmq_1.Queue('ai', { connection });
async function doFetch(client, seq, uid, accountId, mailboxId, prisma, job) {
    for await (const msg of client.fetch(seq, { source: true, envelope: true, internalDate: true, size: true, flags: true })) {
        const rawBuf = msg.source;
        const envelope = msg.envelope || {};
        const internalDate = msg.internalDate ? new Date(msg.internalDate) : new Date();
        const size = msg.size ? Number(msg.size) : rawBuf.length;
        const flags = msg.flags || [];
        const messageId = envelope.messageId || null;
        const parsed = await (0, mailparser_1.simpleParser)(stream_1.Readable.from(rawBuf));
        const inserted = await prisma.$queryRaw `
      INSERT INTO messages (account_id, mailbox_id, uid, uid_validity, message_id, subject, from_header, to_header, cc_header, internal_date, size_bytes, flags, raw, created_at, updated_at)
      VALUES (
        ${accountId}, ${mailboxId}, ${uid}, NULL, ${messageId}, ${parsed.subject ?? null}, ${JSON.stringify(parsed.from?.value ?? null)}, ${JSON.stringify(parsed.to?.value ?? null)}, ${JSON.stringify(parsed.cc?.value ?? null)}, ${internalDate}, ${size}, ${flags}, ${rawBuf}, now(), now()
      )
      ON CONFLICT (mailbox_id, uid) DO UPDATE SET subject = EXCLUDED.subject, updated_at = now(), raw = EXCLUDED.raw
      RETURNING id, (xmax = 0) AS inserted`;
        const messageIdRow = (inserted && inserted[0] && inserted[0].id) || null;
        const isInserted = Boolean(inserted && inserted[0] && inserted[0].inserted);
        if (messageIdRow) {
            await prisma.$queryRaw `
        INSERT INTO sync_state (mailbox_id, last_uid, last_checked_at)
        VALUES (${mailboxId}, ${uid}, now())
        ON CONFLICT (mailbox_id) DO UPDATE
        SET last_uid = GREATEST(sync_state.last_uid, EXCLUDED.last_uid), last_checked_at = now()`;
        }
        if (messageIdRow && isInserted) {
            await prisma.$queryRaw `
        INSERT INTO message_versions (message_id, version, raw, reason, created_by, created_at)
        VALUES (${messageIdRow}, 1, ${rawBuf}, 'initial', 'parser', now())
        ON CONFLICT (message_id, version) DO NOTHING`;
            const attachments = parsed.attachments || [];
            for (const at of attachments) {
                const sha = crypto.createHash('sha256').update(at.content).digest();
                await prisma.$queryRaw `
          INSERT INTO attachments (message_id, filename, content_type, size_bytes, content_id, sha256, stored_path, created_at)
          VALUES (${messageIdRow}, ${at.filename ?? null}, ${at.contentType ?? null}, ${at.size ?? at.content.length}, ${at.cid ?? null}, ${sha}, NULL, now())`;
            }
            const insertedAi = await prisma.$queryRaw `
        INSERT INTO ai_metadata (message_id, model, provider, created_at)
        VALUES (${messageIdRow}, 'pending', 'local', now())
        ON CONFLICT (message_id, version) DO NOTHING
        RETURNING id`;
            const aiRows = await prisma.$queryRaw `
        SELECT id FROM ai_metadata WHERE message_id = ${messageIdRow} AND version = 1 LIMIT 1`;
            const aiMetadataId = (insertedAi && insertedAi[0] && insertedAi[0].id) || (aiRows && aiRows[0] && aiRows[0].id);
            if (aiMetadataId) {
                try {
                    const icsList = [];
                    for (const at of attachments) {
                        const ctype = (at.contentType || '').toLowerCase();
                        const fname = (at.filename || '').toLowerCase();
                        if (ctype === 'text/calendar' || fname.endsWith('.ics')) {
                            try {
                                const text = at.content ? at.content.toString('utf8') : '';
                                if (text.includes('BEGIN:VCALENDAR'))
                                    icsList.push(text);
                            }
                            catch (_) { }
                        }
                    }
                    if (parsed && parsed.text && parsed.text.includes('BEGIN:VCALENDAR')) {
                        icsList.push(parsed.text);
                    }
                    function parseIcs(ics) {
                        const events = [];
                        const veventMatches = ics.split(/BEGIN:VCALENDAR/i).slice(1).join('BEGIN:VCALENDAR').match(/BEGIN:V?VEVENT[\s\S]*?END:V?VEVENT/gi) || [];
                        for (const v of veventMatches) {
                            const get = (k) => {
                                const re = new RegExp(k + ':(.*?)\r?\n', 'i');
                                const m = v.match(re);
                                return m ? m[1].trim() : null;
                            };
                            const summary = get('SUMMARY');
                            const location = get('LOCATION');
                            const dtstart = get('DTSTART');
                            const dtend = get('DTEND');
                            const attendeesRaw = Array.from((v.match(/ATTENDEE[:;].*?CN=([^;\r\n]*)/gi) || [])).map(s => s.replace(/ATTENDEE[:;].*?CN=/i, ''));
                            const attendees = attendeesRaw.length ? attendeesRaw : null;
                            let startTs = null;
                            let endTs = null;
                            try {
                                if (dtstart)
                                    startTs = new Date(dtstart);
                                if (dtend)
                                    endTs = new Date(dtend);
                            }
                            catch (_) { }
                            events.push({ summary, location, startTs, endTs, attendees });
                        }
                        return events;
                    }
                    for (const ics of icsList) {
                        const evs = parseIcs(ics);
                        for (const ev of evs) {
                            try {
                                await prisma.$queryRaw `
                  INSERT INTO events (message_id, ai_metadata_id, start_ts, end_ts, summary, location, attendees, source, created_at)
                  VALUES (${messageIdRow}, ${aiMetadataId}, ${ev.startTs}, ${ev.endTs}, ${ev.summary}, ${ev.location}, ${JSON.stringify(ev.attendees ?? {})}::jsonb, 'ical', now())`;
                            }
                            catch (e) {
                                console.warn('failed to insert event from ics', e?.message || e);
                            }
                        }
                    }
                }
                catch (e) {
                    console.warn('error parsing ics attachments', e?.message || e);
                }
                try {
                    const trackingItems = [];
                    const textForScan = (parsed && (parsed.text || parsed.html || '')) || '';
                    function tryParseDateFromSnippet(s) {
                        if (!s)
                            return null;
                        const datePhrases = /(estimated delivery|expected delivery|delivery date|delivered on|arrives on|delivery expected|expected arrival)[:\s]*([^\n\r<]+)/i;
                        const m = s.match(datePhrases);
                        if (m && m[2]) {
                            const cand = m[2].trim().replace(/<[^>]*>/g, '');
                            const d = Date.parse(cand);
                            if (!Number.isNaN(d))
                                return new Date(d).toISOString();
                        }
                        const dateRe = /(\d{4}-\d{2}-\d{2})|(\d{1,2}\/\d{1,2}\/\d{2,4})|([A-Za-z]{3,9} \d{1,2},? \d{4})/g;
                        const found = s.match(dateRe);
                        if (found && found.length) {
                            for (const f of found) {
                                const d = Date.parse(f);
                                if (!Number.isNaN(d))
                                    return new Date(d).toISOString();
                            }
                        }
                        return null;
                    }
                    if (textForScan) {
                        const urlRe = /https?:\/\/[\w\-./?&=%#]+/gi;
                        const urls = Array.from(new Set((textForScan.match(urlRe) || [])));
                        for (const u of urls) {
                            const ul = String(u).toLowerCase();
                            const idx = textForScan.indexOf(u);
                            const snippet = idx >= 0 ? textForScan.slice(Math.max(0, idx - 200), Math.min(textForScan.length, idx + 200)) : '';
                            const delivery = tryParseDateFromSnippet(snippet);
                            if (ul.includes('track') || ul.includes('tracking') || ul.includes('/t/')) {
                                trackingItems.push({ carrier: 'unknown', trackingNumber: null, url: u, status: null, deliveryDate: delivery });
                            }
                            if (ul.includes('ups.com') || ul.includes('1z')) {
                                trackingItems.push({ carrier: 'UPS', trackingNumber: null, url: u, status: null, deliveryDate: delivery });
                            }
                            if (ul.includes('fedex.com'))
                                trackingItems.push({ carrier: 'FEDEX', trackingNumber: null, url: u, status: null, deliveryDate: delivery });
                            if (ul.includes('usps.com') || ul.includes('usps'))
                                trackingItems.push({ carrier: 'USPS', trackingNumber: null, url: u, status: null, deliveryDate: delivery });
                        }
                        const trackingRe = /(1Z[0-9A-Z]{16})|([0-9]{12,22})/g;
                        const found = Array.from(new Set((textForScan.match(trackingRe) || [])));
                        for (const f of found) {
                            const clean = String(f).trim();
                            if (/[\/\-]/.test(clean))
                                continue;
                            const idx = textForScan.indexOf(clean);
                            const snippet = idx >= 0 ? textForScan.slice(Math.max(0, idx - 200), Math.min(textForScan.length, idx + 200)) : '';
                            const delivery = tryParseDateFromSnippet(snippet);
                        }
                    }
                    if (trackingItems.length) {
                        await prisma.$queryRaw `
              UPDATE ai_metadata
              SET tracking = ${JSON.stringify(trackingItems)}::jsonb
              WHERE id = ${aiMetadataId}`;
                    }
                }
                catch (e) {
                    console.warn('error extracting tracking heuristics', e?.message || e);
                }
                await aiQueue.add('classify-message', { messageId: messageIdRow, aiMetadataId }, { attempts: 3, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: true, removeOnFail: false });
            }
        }
        try {
            const acct = await prisma.account.findUnique({ where: { id: accountId }, select: { userId: true } });
            const userId = (acct && acct.userId) || null;
            if (userId && messageIdRow) {
                await (0, redis_pub_1.publishNotification)({ type: 'message.created', userId, mailboxId, messageId: messageIdRow, subject: parsed.subject || null, from: parsed.from?.value?.[0] || null, internalDate: internalDate.toISOString() });
            }
        }
        catch (e) {
            console.warn('publish notification failed', e?.message || e);
        }
        console.log(`Parsed and stored message uid=${uid} (message_id=${messageIdRow})`);
    }
}
const parseJobProcessor = async (job) => {
    const prisma = new prisma_service_1.PrismaService();
    let client;
    let accountId = '';
    let mailbox;
    let uid;
    try {
        ({ accountId, mailbox = 'INBOX', uid } = job.data);
        if (!accountId || !uid)
            throw new Error('Missing accountId or uid');
        const account = await prisma.account.findUnique({ where: { id: accountId } });
        if (!account)
            throw new Error(`Account ${accountId} not found`);
        let cfg = account.config || {};
        if ((!cfg.host || !cfg.user || !cfg.pass) && account.encryptedCredentials && account.encryptedCredentials.length) {
            try {
                cfg = (0, crypto_1.decryptJson)(account.encryptedCredentials);
            }
            catch (e) {
                console.error('failed to decrypt account credentials for parse processor', account.id, e?.message);
            }
        }
        const IMAP_DEBUG = (process.env.IMAP_DEBUG || 'false') === 'true';
        const IMAP_LOGGER = IMAP_DEBUG ? console : { debug: () => { }, info: () => { }, warn: () => { }, error: () => { } };
        const imapCfg = {
            host: cfg.host || process.env.IMAP_HOST || 'localhost',
            port: cfg.port ?? (process.env.IMAP_PORT ? Number(process.env.IMAP_PORT) : 993),
            secure: cfg.secure ?? (process.env.IMAP_SECURE ? process.env.IMAP_SECURE === 'true' : true),
            auth: cfg.auth || { user: cfg.user || account.email, pass: cfg.pass || '' }
        };
        let pool = imapClientPool.get(accountId) || [];
        if (pool.length >= MAX_CLIENTS_PER_ACCOUNT) {
            throw new Error(`Too many concurrent IMAP connections for account ${accountId} (${pool.length}/${MAX_CLIENTS_PER_ACCOUNT})`);
        }
        client = new imapflow_1.ImapFlow({
            host: imapCfg.host,
            port: imapCfg.port,
            secure: imapCfg.secure,
            auth: imapCfg.auth,
            socketTimeout: 30000,
            logger: IMAP_LOGGER
        });
        pool.push(client);
        imapClientPool.set(accountId, pool);
        try {
            await client.connect();
        }
        catch (e) {
            const idx = pool.indexOf(client);
            if (idx > -1)
                pool.splice(idx, 1);
            imapClientPool.set(accountId, pool);
            throw e;
        }
        const mb = await prisma.$queryRaw `
      INSERT INTO mailboxes (account_id, name, path, created_at)
      VALUES (${accountId}, ${mailbox}, ${mailbox}, now())
      ON CONFLICT (account_id, path) DO UPDATE SET name = EXCLUDED.name RETURNING id`;
        const mailboxRow = mb;
        const mailboxFallback = await prisma.$queryRaw `SELECT id FROM mailboxes WHERE account_id = ${accountId} AND path = ${mailbox} LIMIT 1`;
        const mailboxId = (mailboxRow && mailboxRow[0] && mailboxRow[0].id) || (mailboxFallback && mailboxFallback[0] && mailboxFallback[0].id);
        const existing = await prisma.$queryRaw `
      SELECT id, raw FROM messages WHERE mailbox_id = ${mailboxId} AND uid = ${uid} LIMIT 1`;
        if (existing && existing[0] && existing[0].raw) {
            await prisma.$queryRaw `
        INSERT INTO sync_state (mailbox_id, last_uid, last_checked_at)
        VALUES (${mailboxId}, ${uid}, now())
        ON CONFLICT (mailbox_id) DO UPDATE
        SET last_uid = GREATEST(sync_state.last_uid, EXCLUDED.last_uid), last_checked_at = now()`;
            console.log(`Skipping parse for existing message uid=${uid} (message_id=${existing[0].id})`);
            return { ok: true, skipped: true };
        }
        const lock = await client.getMailboxLock(mailbox);
        try {
            const seq = job.data && job.data.seq ? String(job.data.seq) : String(uid);
            await doFetch(client, seq, uid, accountId, mailboxId, prisma, job);
        }
        finally {
            lock.release();
        }
        return { ok: true };
    }
    catch (err) {
        console.error('parseJobProcessor error', err);
        throw err;
    }
    finally {
        try {
            if (client && accountId) {
                await client.logout();
                const pool = imapClientPool.get(accountId) || [];
                const idx = pool.indexOf(client);
                if (idx > -1)
                    pool.splice(idx, 1);
                imapClientPool.set(accountId, pool);
            }
        }
        catch (e) {
            console.warn('Error logging out IMAP client', e?.message);
        }
        try {
            await prisma.$disconnect();
        }
        catch (_) { }
    }
};
exports.parseJobProcessor = parseJobProcessor;
exports.parseWorkerOptions = { concurrency: 3 };
exports.default = exports.parseJobProcessor;
