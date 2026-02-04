"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startIdleService = startIdleService;
const imapflow_1 = require("imapflow");
const ioredis_1 = require("ioredis");
const bullmq_1 = require("bullmq");
const crypto_1 = require("../utils/crypto");
const connection = new ioredis_1.default(process.env.REDIS_URL || 'redis://localhost:6379', { maxRetriesPerRequest: null });
const fetchQueue = new bullmq_1.Queue('fetch', { connection });
const MAX_IDLE_CONNECTIONS = Number(process.env.IDLE_MAX_CONNECTIONS || 20);
const IDLE_RECONNECT_BASE = Number(process.env.IDLE_RECONNECT_BASE_MS || 5000);
const IDLE_ENABLED = (process.env.IDLE_ENABLED || 'true') === 'true';
const MANUAL_POLL_MIN_MS = Number(process.env.MANUAL_POLL_MIN_MS || 60 * 1000);
const IMAP_DEBUG = (process.env.IMAP_DEBUG || 'false') === 'true';
const IMAP_LOGGER = IMAP_DEBUG ? console : { debug: () => { }, info: () => { }, warn: () => { }, error: () => { } };
function startIdleService(prisma) {
    if (!IDLE_ENABLED) {
        console.log('IMAP IDLE disabled via IDLE_ENABLED=false');
        return;
    }
    const activeClients = new Map();
    const lastManualPollAt = new Map();
    async function enqueueManualPoll(accountId, reason) {
        const now = Date.now();
        const last = lastManualPollAt.get(accountId) || 0;
        if (now - last < MANUAL_POLL_MIN_MS)
            return;
        lastManualPollAt.set(accountId, now);
        try {
            await fetchQueue.add('fetch-account', { accountId, reason }, { removeOnComplete: true, removeOnFail: false });
            console.log('[idle] manual poll enqueued', accountId, reason);
        }
        catch (e) {
            console.warn('[idle] failed to enqueue manual poll', accountId, reason, e?.message || e);
        }
    }
    async function connectLoop(account) {
        const accountId = account.id;
        let attempt = 0;
        while (true) {
            if (activeClients.has(accountId) && activeClients.get(accountId).stopped)
                break;
            try {
                const cfg = (account.config && Object.keys(account.config).length) ? account.config : (0, crypto_1.decryptJson)(account.encryptedCredentials);
                const client = new imapflow_1.ImapFlow({
                    host: cfg.host || process.env.IMAP_HOST || 'localhost',
                    port: cfg.port ?? (process.env.IMAP_PORT ? Number(process.env.IMAP_PORT) : 993),
                    secure: cfg.secure ?? (process.env.IMAP_SECURE ? process.env.IMAP_SECURE === 'true' : true),
                    auth: cfg.auth || { user: cfg.user || account.email, pass: cfg.pass || '' },
                    logger: IMAP_LOGGER
                });
                activeClients.set(accountId, { client, stopped: false });
                client.on('error', (err) => {
                    console.warn('[idle] imap client error', accountId, err?.message || err);
                });
                client.on('close', () => {
                    console.log('[idle] imap client closed', accountId);
                });
                await client.connect();
                try {
                    await client.mailboxOpen('INBOX', { readOnly: true });
                }
                catch (e) {
                    console.warn('[idle] failed to open INBOX for', accountId, e?.message || e);
                }
                const getUidNext = () => {
                    const mailbox = client.mailbox;
                    if (!mailbox || mailbox === false)
                        return null;
                    const uidNext = mailbox.uidNext;
                    return uidNext ? Number(uidNext) : null;
                };
                let lastUidNext = getUidNext();
                while (!activeClients.get(accountId).stopped) {
                    try {
                        await client.idle();
                    }
                    catch (e) {
                    }
                    try {
                        const status = getUidNext();
                        if (status && lastUidNext && status > lastUidNext) {
                            console.log('[idle] uidNext increased; enqueue fetch', accountId, lastUidNext, '->', status);
                            try {
                                await fetchQueue.add('fetch-account', { accountId }, { removeOnComplete: true, removeOnFail: false });
                            }
                            catch (e) {
                                console.warn('[idle] failed to enqueue fetch job after idle check', e);
                            }
                        }
                        lastUidNext = status || lastUidNext;
                    }
                    catch (e) {
                        console.warn('[idle] post-idle mailbox check failed', accountId, e?.message || e);
                    }
                    await new Promise(res => setTimeout(res, 1000));
                }
                try {
                    await client.logout();
                }
                catch (_) { }
                try {
                    await client.close();
                }
                catch (_) { }
                activeClients.delete(accountId);
                break;
            }
            catch (e) {
                await enqueueManualPoll(accountId, 'idle-connect-failed');
                attempt += 1;
                const backoff = Math.min(60000, IDLE_RECONNECT_BASE * attempt);
                console.warn('[idle] connection failed, will retry in', backoff, 'ms', accountId, e?.message || e);
                await new Promise(res => setTimeout(res, backoff));
            }
        }
    }
    async function start() {
        try {
            const accounts = await prisma.account.findMany();
            let started = 0;
            for (const acc of accounts) {
                if (started >= MAX_IDLE_CONNECTIONS)
                    break;
                if (!acc.encryptedCredentials || acc.encryptedCredentials.length === 0)
                    continue;
                connectLoop(acc).catch(err => console.warn('[idle] unhandled connectLoop error', err));
                started += 1;
            }
            setInterval(async () => {
                try {
                    const accountsNow = await prisma.account.findMany();
                    for (const acc of accountsNow) {
                        if (activeClients.has(acc.id))
                            continue;
                        if (activeClients.size >= MAX_IDLE_CONNECTIONS)
                            break;
                        if (!acc.encryptedCredentials || acc.encryptedCredentials.length === 0)
                            continue;
                        connectLoop(acc).catch(err => console.warn('[idle] unhandled connectLoop error', err));
                    }
                }
                catch (e) {
                    console.warn('[idle] refresh accounts failed', e?.message || e);
                }
            }, 60000);
            console.log('[idle] IMAP IDLE manager started');
        }
        catch (e) {
            console.warn('[idle] IMAP IDLE manager failed to start', e?.message || e);
        }
    }
    start().catch(e => console.warn('[idle] start error', e));
}
