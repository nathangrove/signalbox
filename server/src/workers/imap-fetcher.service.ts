import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { ImapFlow } from 'imapflow';
import { decryptJson } from '../utils/crypto';

const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', { maxRetriesPerRequest: null });

// Toggle verbose IMAP/imapflow protocol logs with IMAP_DEBUG=true. Default is silent.
const IMAP_DEBUG = (process.env.IMAP_DEBUG || 'false') === 'true';
const IMAP_LOGGER = IMAP_DEBUG ? console : { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

@Injectable()
export class ImapFetcherService implements OnModuleDestroy {
  private fetchQueue: Queue;

  constructor(private readonly prisma: PrismaService) {
    // use a BullMQ queue named 'fetch'
    // lazy require to avoid startup ordering issues
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Queue: Q } = require('bullmq');
    this.fetchQueue = new Q('fetch', { connection });
  }

  async fetchAccountHeaders(accountId: string) {
    // load account record to get encrypted credentials
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });
    if (!account) throw new Error('account not found');

    // decrypt credentials - prefer encryptedCredentials if present
    let cfg = (account as any).config || {};
    if ((!cfg.imapHost || !cfg.imapUser || !cfg.imapPass) && account.encryptedCredentials && account.encryptedCredentials.length) {
      try {
        cfg = decryptJson(account.encryptedCredentials);
      } catch (err) {
        console.error('failed to decrypt account credentials', account.id, err);
      }
    }

    if (!cfg.imapHost) throw new Error('missing imap host');
    if (!cfg.imapUser) throw new Error('missing imap user');
    if (!cfg.imapPass) throw new Error('missing imap pass');

    const host = cfg.imapHost;
    const port = cfg.imapPort || 993;
    const secure = typeof cfg.imapSecure !== 'undefined' ? cfg.imapSecure : true;
    const user = cfg.imapUser;
    const pass = cfg.imapPass;

    const client = new ImapFlow({
      host,
      port,
      secure,
      auth: { user, pass },
      logger: IMAP_LOGGER
    });

    await client.connect();
    try {
      // list mailboxes and fetch headers for INBOX
      for await (const mailbox of await (client as any).listMailboxes()) {
        // skip non-selectable
        if (mailbox.flags && mailbox.flags.includes('\\Noselect')) continue;
        // open mailbox
        await client.mailboxOpen(mailbox.path, { readOnly: true });
        // fetch headers for all messages
        const lock = await client.getMailboxLock(mailbox.path);
        try {
          for await (const message of client.fetch('1:*', { envelope: true }, { uid: true })) {
            // enqueue parse job (header-only) referencing account/mailbox/message uid
            await this.fetchQueue.add('parse-header', {
              accountId,
              mailbox: mailbox.path,
              uid: message.uid,
              seq: message.seq,
              envelope: message.envelope,
            });
          }
        } finally {
          lock.release();
        }
      }
    } finally {
      await client.logout();
    }
  }

  async onModuleDestroy() {
    await connection.quit();
  }
}
