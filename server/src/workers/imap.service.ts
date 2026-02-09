import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ImapFlow } from 'imapflow';
import { QueueService } from './queue.service';

const DEFAULT_FETCH_COUNT = 20;

// Toggle verbose IMAP/imapflow protocol logs with IMAP_DEBUG=true. Default is silent.
const IMAP_DEBUG = (process.env.IMAP_DEBUG || 'false') === 'true';
const IMAP_LOGGER = IMAP_DEBUG ? console : { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

@Injectable()
export class ImapService implements OnModuleDestroy {
  private clients: Map<string, ImapFlow> = new Map();

  constructor(private readonly queueService: QueueService) {}


  async onModuleDestroy() {
    for (const c of this.clients.values()) {
      try { await c.logout(); } catch (_) {}
    }
  }

  async syncAccount(accountId: string, cfg: { host: string; port?: number; secure?: boolean; auth: { user: string; pass: string } }) {
    // support plain user/pass in cfg.auth or OAuth tokens in cfg.oauth
    let auth: any = cfg.auth;
    if ((!auth || !auth.pass) && (cfg as any).oauth && (cfg as any).oauth.access_token) {
      const oauth = (cfg as any).oauth;
      const user = cfg.auth?.user || (cfg as any).user;
      // ImapFlow expects `accessToken` on the auth object for token-based auth
      auth = { user, accessToken: oauth.access_token };
    }

    const client = new ImapFlow({
      host: cfg.host,
      port: cfg.port ?? 993,
      secure: cfg.secure ?? true,
      auth,
      logger: IMAP_LOGGER // disable verbose IMAP/imapflow internal logs (toggle with IMAP_DEBUG=true)
    });

    await client.connect();
    this.clients.set(accountId, client);

    try {
      // List mailboxes and sync INBOX as example
      // Quietly iterate mailboxes (no noisy IMAP logs); we only report high-level actions
      const mailboxPaths: string[] = [];
      for await (const mailbox of (client as any).listMailboxes()) {
        const path = mailbox.path || mailbox.name;
        mailboxPaths.push(path);
      }

      // open INBOX and perform a sync limited to a lookback window (e.g., last 6 months)
      console.log(`[sync] performing poll sync for account ${accountId}`);

      const lock = await client.getMailboxLock('INBOX');
      try {
        const mailbox = client.mailbox as any; // after open
        const exists = mailbox?.exists || 0;
        if (exists === 0) return;

        // lookback days and max messages are configurable via env
        const lookbackDays = Number(process.env.IMPORT_LOOKBACK_DAYS || 183); // ~6 months
        const maxMessages = Number(process.env.IMPORT_MAX_MESSAGES || 10000);
        const sinceDate = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

        // Search for messages since the date. ImapFlow search returns matched sequence numbers/UIDs.
        let uids: number[] = [];
        try {
          uids = await client.search({ since: sinceDate });
        } catch (e) {
          console.warn('[sync] search by date failed, falling back to recent messages', (e as any)?.message || e);
        }

        // If search didn't work or returned nothing, fall back to recent DEFAULT_FETCH_COUNT
        if (!uids || uids.length === 0) {
          const start = Math.max(1, exists - DEFAULT_FETCH_COUNT + 1);
          const range = `${start}:${exists}`;
          uids = [];
          for await (const msg of client.fetch(range, { envelope: true, internalDate: true }, { uid: true })) {
            uids.push(msg.uid as number);
          }
        }

        if (!uids || uids.length === 0) {
          console.log('[sync] no messages found for requested window');
          return;
        }

        // Keep only the newest up to maxMessages
        if (uids.length > maxMessages) uids = uids.slice(uids.length - maxMessages);

        // Helper: compress numeric uid array into IMAP sequence-set like "1,3,5:10,12"
        function compressSeq(arr: number[]) {
          if (!arr.length) return '';
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

        // Fetch in chunks to avoid huge requests (chunk by ~200 ranges)
        const CHUNK_UIDS = 200;
        let enqueued = 0;
        for (let i = 0; i < uids.length; i += CHUNK_UIDS) {
          const chunk = uids.slice(i, i + CHUNK_UIDS);
          const seq = compressSeq(chunk);
          for await (const msg of client.fetch(seq, { envelope: true, internalDate: true }, { uid: true })) {
            const uid = msg.uid as number;
            const payload = { accountId, mailbox: 'INBOX', uid };
            const jobId = `${accountId}-INBOX-${uid}`;
            await this.queueService.queues.parse.add('parse-message', payload, { jobId, removeOnComplete: true });
            enqueued += 1;
          }
        }

        console.log(`[sync] enqueued ${enqueued} parse job(s) for account ${accountId} (mailbox INBOX)`);
      } finally {
        lock.release();
      }
    } finally {
      // keep connection open for future use in this example; don't logout immediately
    }
  }
}
