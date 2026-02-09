import { ImapFlow } from 'imapflow';
import IORedis from 'ioredis';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { decryptJson } from '../utils/crypto';

const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', { maxRetriesPerRequest: null });
const fetchQueue = new Queue('fetch', { connection });

const MAX_IDLE_CONNECTIONS = Number(process.env.IDLE_MAX_CONNECTIONS || 20);
const IDLE_RECONNECT_BASE = Number(process.env.IDLE_RECONNECT_BASE_MS || 5000);
const IDLE_ENABLED = (process.env.IDLE_ENABLED || 'true') === 'true';
const MANUAL_POLL_MIN_MS = Number(process.env.MANUAL_POLL_MIN_MS || 60 * 1000);

// Toggle verbose IMAP/imapflow protocol logs with IMAP_DEBUG=true. Default is silent.
const IMAP_DEBUG = (process.env.IMAP_DEBUG || 'false') === 'true';
const IMAP_LOGGER = IMAP_DEBUG ? console : { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }; 

export function startIdleService(prisma: any) {
  if (!IDLE_ENABLED) {
    console.log('IMAP IDLE disabled via IDLE_ENABLED=false');
    return;
  }

  const activeClients: Map<string, { client: ImapFlow; stopped: boolean }> = new Map();
  const lastManualPollAt: Map<string, number> = new Map();

  async function enqueueManualPoll(accountId: string, reason: string) {
    const now = Date.now();
    const last = lastManualPollAt.get(accountId) || 0;
    if (now - last < MANUAL_POLL_MIN_MS) return;
    lastManualPollAt.set(accountId, now);
    try {
      await fetchQueue.add('fetch-account', { accountId, reason }, { removeOnComplete: true, removeOnFail: false });
      console.log('[idle] manual poll enqueued', accountId, reason);
    } catch (e) {
      console.warn('[idle] failed to enqueue manual poll', accountId, reason, (e as any)?.message || e);
    }
  }

  async function connectLoop(account: any) {
    const accountId = account.id;
    let attempt = 0;

    while (true) {
      if (activeClients.has(accountId) && activeClients.get(accountId)!.stopped) break;
      // Re-load account state before attempting to connect so we honor runtime changes
      try {
        const latest = await prisma.account.findUnique({ where: { id: accountId } });
        if (latest && (latest as any).syncDisabled) {
          console.log('[idle] account marked syncDisabled before connect, aborting idle start', accountId);
          break;
        }
      } catch (e) {
        console.warn('[idle] failed to re-load account before connect', accountId, (e as any)?.message || e);
      }
      try {
        const cfg = (account.config && Object.keys(account.config).length) ? account.config : decryptJson(account.encryptedCredentials);
        console.log('[idle] connecting imap idle for account', accountId, account.email, cfg);
        if (!cfg || !(cfg.imapHost || cfg.host)) {
          console.warn('[idle] missing imap host, cannot start idle', accountId);
          await enqueueManualPoll(accountId, 'idle-missing-credentials');
          break;
        }

        const imapHost = cfg.imapHost || cfg.host;
        const imapPort = cfg.imapPort ?? cfg.port ?? 993;
        const imapSecure = typeof cfg.imapSecure !== 'undefined' ? cfg.imapSecure : (typeof cfg.secure !== 'undefined' ? cfg.secure : true);
        const imapUser = cfg.imapUser || cfg.user || account.email;

        // Determine auth: prefer explicit cfg.auth, then plain pass, then OAuth token (xoauth2)
        let authObj: any = undefined;
        if (cfg.auth && (cfg.auth.user || cfg.auth.pass || cfg.auth.xoauth2)) {
          authObj = cfg.auth;
        } else if (cfg.imapPass || cfg.pass) {
          authObj = { user: imapUser, pass: cfg.imapPass || cfg.pass };
        } else if (cfg.oauth && cfg.oauth.access_token) {
          // ImapFlow expects `accessToken` on the auth object for token-based auth
          authObj = { user: imapUser, accessToken: cfg.oauth.access_token };
        }

        if (!imapUser || !authObj) {
          console.warn('[idle] missing imap credentials, cannot start idle', accountId);
          await enqueueManualPoll(accountId, 'idle-missing-credentials');
          break;
        }

        // Debug: indicate auth type for idle client
        if (authObj && (authObj as any).accessToken) {
          console.log('[idle] using token auth (accessToken present) for account', accountId);
        } else if (authObj && (authObj as any).pass) {
          console.log('[idle] using password auth for account', accountId);
        }

        const client = new ImapFlow({
          host: imapHost,
          port: imapPort,
          secure: imapSecure,
          auth: authObj,
          logger: IMAP_LOGGER
        });

        activeClients.set(accountId, { client, stopped: false });

        client.on('error', (err: any) => {
          console.warn('[idle] imap client error', accountId, err?.message || err);
        });

        client.on('close', () => {
          console.log('[idle] imap client closed', accountId);
        });

        // Use idle loop + uidNext change detection for new mail.

        await client.connect();

        try {
          // Open INBOX to track uidNext
          await client.mailboxOpen('INBOX', { readOnly: true });
        } catch (e) {
          console.warn('[idle] failed to open INBOX for', accountId, (e as any)?.message || e);
        }

        const getUidNext = () => {
          const mailbox: any = client.mailbox as any;
          if (!mailbox || mailbox === false) return null;
          const uidNext = mailbox.uidNext;
          return uidNext ? Number(uidNext) : null;
        };

        let lastUidNext: number | null = getUidNext();

        // keep an idle loop; when idle returns (or an exists event fires), schedule fetch
        while (!activeClients.get(accountId)!.stopped) {
          try {
            // idle with long timeout (max ~29 minutes per RFC)
            await client.idle();
          } catch (e) {
            // idle aborted (timeout or network) — we'll re-check mailbox status and reconnect as needed
            // console.warn('[idle] idle returned', accountId, (e as any)?.message || e);
          }

          // after idle or an event, check uidNext quickly
          try {
            // If the account has been disabled while idleing, stop and cleanup
            try {
              const latestDuring = await prisma.account.findUnique({ where: { id: accountId } });
              if (latestDuring && (latestDuring as any).syncDisabled) {
                console.log('[idle] account disabled during idle, stopping client', accountId);
                activeClients.get(accountId)!.stopped = true;
                break;
              }
            } catch (rd) {
              // non-fatal — continue to check uidNext
            }
            const status = getUidNext();
            if (status && lastUidNext && status > lastUidNext) {
              console.log('[idle] uidNext increased; enqueue fetch', accountId, lastUidNext, '->', status);
              try { await fetchQueue.add('fetch-account', { accountId }, { removeOnComplete: true, removeOnFail: false }); } catch (e) { console.warn('[idle] failed to enqueue fetch job after idle check', e); }
            }
            lastUidNext = status || lastUidNext;
          } catch (e) {
            console.warn('[idle] post-idle mailbox check failed', accountId, (e as any)?.message || e);
          }

          // small pause before re-entering idle to avoid tight loop
          await new Promise(res => setTimeout(res, 1000));
        }

        try { await client.logout(); } catch (_) {}
        try { await client.close(); } catch (_) {}
        activeClients.delete(accountId);
        break; // exit loop cleanly
      } catch (e) {
        await enqueueManualPoll(accountId, 'idle-connect-failed');
        attempt += 1;
        const backoff = Math.min(60000, IDLE_RECONNECT_BASE * attempt);
        console.warn('[idle] connection failed, will retry in', backoff, 'ms', accountId, (e as any)?.message || e);
        await new Promise(res => setTimeout(res, backoff));
      }
    }
  }

  async function start() {
    try {
      const accounts = await prisma.account.findMany();
      let started = 0;
      for (const acc of accounts) {
        if (started >= MAX_IDLE_CONNECTIONS) break;
        if (acc.syncDisabled) continue;
        // start only if encrypted credentials exist OR config has credential fields
        const hasCreds = (acc.encryptedCredentials && acc.encryptedCredentials.length) || (acc.config && Object.keys(acc.config).length);
        if (!hasCreds) continue;
        connectLoop(acc).catch(err => console.warn('[idle] unhandled connectLoop error', err));
        started += 1;
      }

      // refresh periodically to pick up new accounts and stop idle clients for accounts that became disabled
      setInterval(async () => {
        try {
          const accountsNow = await prisma.account.findMany();
          // Stop active clients for accounts that are now disabled
          try {
            const disabledSet = new Set((accountsNow.filter(a => a.syncDisabled).map(a => a.id)));
            for (const [id, entry] of Array.from(activeClients.entries())) {
              if (disabledSet.has(id)) {
                console.log('[idle] stopping active idle client due to syncDisabled', id);
                entry.stopped = true;
                try { await entry.client.logout(); } catch (_) {}
                try { await entry.client.close(); } catch (_) {}
                activeClients.delete(id);
              }
            }
          } catch (stopErr) {
            console.warn('[idle] failed to stop disabled active clients', (stopErr as any)?.message || stopErr);
          }

          for (const acc of accountsNow) {
            if (activeClients.has(acc.id)) continue;
            if (activeClients.size >= MAX_IDLE_CONNECTIONS) break;
            if (acc.syncDisabled) continue;
            const hasCredsNow = (acc.encryptedCredentials && acc.encryptedCredentials.length) || (acc.config && Object.keys(acc.config).length);
            if (!hasCredsNow) continue;
            connectLoop(acc).catch(err => console.warn('[idle] unhandled connectLoop error', err));
          }
        } catch (e) { console.warn('[idle] refresh accounts failed', (e as any)?.message || e); }
      }, 60_000);

      console.log('[idle] IMAP IDLE manager started');
    } catch (e) {
      console.warn('[idle] IMAP IDLE manager failed to start', (e as any)?.message || e);
    }
  }

  start().catch(e => console.warn('[idle] start error', e));
}
