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
    const client = new ImapFlow({
      host: cfg.host,
      port: cfg.port ?? 993,
      secure: cfg.secure ?? true,
      auth: cfg.auth,
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

      // open INBOX and perform a short sync; report a concise summary
      console.log(`[sync] performing poll sync for account ${accountId}`);

      const lock = await client.getMailboxLock('INBOX');
      try {
        const mailbox = client.mailbox as any; // after open
        const exists = mailbox?.exists || 0;
        if (exists === 0) return;

        const start = Math.max(1, exists - DEFAULT_FETCH_COUNT + 1);
        const range = `${start}:${exists}`;

        // Fetch envelopes and uid for recent messages
        let enqueued = 0;
        for await (const msg of client.fetch(range, { envelope: true, internalDate: true }, { uid: true })) {
          const uid = msg.uid as number;
          // Enqueue a parse job for this message
          const payload = { accountId, mailbox: 'INBOX', uid };
          await this.queueService.queues.parse.add('parse-message', payload, { removeOnComplete: true, removeOnFail: false });
          enqueued += 1;
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
