import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { simpleParser } from 'mailparser';
import { publishNotification } from '../notifications/redis-pub';
import { Readable } from 'stream';
import { QueueService } from '../workers/queue.service';
import * as crypto from 'crypto';
import * as nodemailer from 'nodemailer';
import { decryptJson } from '../utils/crypto';

@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: QueueService
  ) {}

  async listForUser(userId: string, mailboxId: string, limit = 50, offset = 0, query?: string, category?: string) {
    const take = Math.min(Math.max(limit, 1), 200);
    const skip = Math.max(offset, 0);
    const q = query && query.trim() ? `%${query.trim()}%` : null;

    const rows = await this.prisma.$queryRaw`
      SELECT
        m.id,
        m.subject,
        m.from_header AS "fromHeader",
        m.internal_date AS "internalDate",
        m.size_bytes AS "sizeBytes",
        m.flags,
        m.read AS "read",
        m.archived AS "archived",
        am.labels->>'category' AS "category",
        am.labels->>'spam' AS "spam",
        am.labels->>'categoryReason' AS "categoryReason",
        am.labels->>'cold' AS "cold",
        (am.itinerary IS NOT NULL AND jsonb_typeof(am.itinerary) = 'array' AND jsonb_array_length(am.itinerary) > 0) AS "hasItinerary",
        (am.tracking IS NOT NULL AND jsonb_typeof(am.tracking) = 'array' AND jsonb_array_length(am.tracking) > 0) AS "hasTracking"
      FROM messages m
      JOIN accounts a ON a.id = m.account_id
      LEFT JOIN ai_metadata am ON am.message_id = m.id AND am.version = 1
      WHERE m.mailbox_id = ${mailboxId}
        AND a.user_id = ${userId}
        -- If no search query is provided, hide archived messages; if q is provided, include archived messages in search results
        AND (${q}::text IS NOT NULL OR m.archived = false)
        AND (
          ${q}::text IS NULL OR (
            m.subject ILIKE ${q}
            OR COALESCE(m.from_header::text, '') ILIKE ${q}
            OR COALESCE(m.to_header::text, '') ILIKE ${q}
            OR COALESCE(m.message_id, '') ILIKE ${q}
          )
        )
        AND (${category}::text IS NULL OR COALESCE(am.labels->>'category','other') = ${category})
      ORDER BY m.internal_date DESC NULLS LAST, m.created_at DESC
      LIMIT ${take} OFFSET ${skip}`;

    return (rows as any[]).map(row => ({
      ...row,
      spam: row.spam === 'true',
      read: row.read === true,
      archived: row.archived === true,
      hasItinerary: row.hasItinerary === true,
      hasTracking: row.hasTracking === true
    }));
  }

  async getById(userId: string, id: string) {
    const message = await this.prisma.message.findFirst({
      where: { id, account: { userId } },
      select: {
        id: true,
        subject: true,
        fromHeader: true,
        toHeader: true,
        ccHeader: true,
        internalDate: true,
        sizeBytes: true,
        flags: true,
        raw: true
      }
    });

    // fetch read/archived status via raw query to avoid needing regenerated prisma client
    const statusRows = await this.prisma.$queryRaw`
      SELECT "read", archived FROM messages WHERE id = ${id} LIMIT 1` as any[];
    const status = statusRows && statusRows[0] ? statusRows[0] : null;

    if (!message) throw new NotFoundException('Message not found');

    let text: string | null = null;
    let html: string | null = null;

    if (message.raw) {
      const rawBuf = Buffer.isBuffer(message.raw)
        ? message.raw
        : Buffer.from(message.raw as Uint8Array);
      const parsed = await simpleParser(Readable.from(rawBuf));
      text = parsed.text || null;
      html = parsed.html ? String(parsed.html) : null;
    }

    const aiRows = await this.prisma.$queryRaw`
      SELECT labels->>'category' AS "category", labels->>'spam' AS "spam", labels->>'categoryReason' AS "categoryReason", labels->>'cold' AS "cold", summary, action, itinerary, tracking
      FROM ai_metadata WHERE message_id = ${id} AND version = 1 LIMIT 1` as any[];
    const ai = aiRows && aiRows[0] ? aiRows[0] : null;

    // attachments metadata
    const attachments = await this.prisma.attachment.findMany({
      where: { messageId: id },
      select: { id: true, filename: true, contentType: true, sizeBytes: true, contentId: true }
    });

    return {
      ...message,
      text,
      html,
      read: status?.read === true,
      archived: status?.archived === true,
      category: ai?.category || null,
      spam: ai?.spam === 'true',
      aiSummary: ai?.summary || null,
      aiAction: ai?.action || null,
      aiItinerary: ai?.itinerary || null,
      aiTracking: ai?.tracking || null,
      aiCategoryReason: ai?.categoryReason || null,
      aiCold: ai?.cold === 'true',
      attachments: attachments || []
    };
  }

  async enqueueAiForMessage(userId: string, messageId: string) {
    const message = await this.prisma.message.findFirst({
      where: { id: messageId, account: { userId } },
      select: { id: true }
    });
    if (!message) throw new NotFoundException('Message not found');

    const insertedAi = await this.prisma.$queryRaw`
      INSERT INTO ai_metadata (message_id, model, provider, created_at)
      VALUES (${messageId}, 'pending', 'local', now())
      ON CONFLICT (message_id, version) DO NOTHING
      RETURNING id` as any[];

    const aiRows = await this.prisma.$queryRaw`
      SELECT id FROM ai_metadata WHERE message_id = ${messageId} AND version = 1 LIMIT 1` as any[];
    const aiMetadataId = (insertedAi && insertedAi[0] && insertedAi[0].id) || (aiRows && aiRows[0] && aiRows[0].id);

    if (aiMetadataId) {
      await this.queueService.queues.ai.add('classify-message', { messageId, aiMetadataId }, { attempts: 3, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: true, removeOnFail: false });
      // also request summary + recommended action
      await this.queueService.queues['ai-action'].add('summarize-action', { messageId, aiMetadataId }, { removeOnComplete: true, removeOnFail: false });
    }

    return { ok: true };
  }

  async markRead(userId: string, messageId: string, read = true) {
    const found = await this.prisma.$queryRaw`
      SELECT m.id FROM messages m JOIN accounts a ON a.id = m.account_id WHERE m.id = ${messageId} AND a.user_id = ${userId} LIMIT 1` as any[];
    if (!found || !found[0]) throw new NotFoundException('Message not found');
    await this.prisma.$queryRaw`
      UPDATE messages SET "read" = ${read}, updated_at = now() WHERE id = ${messageId}`;
    try {
      await publishNotification({ type: 'message.updated', userId, messageId, changes: { read } });
    } catch (e) { console.warn('notify publish failed', (e as any)?.message || e); }
    return { ok: true };
  }

  async setArchived(userId: string, messageId: string, archived: boolean) {
    const found = await this.prisma.$queryRaw`
      SELECT m.id FROM messages m JOIN accounts a ON a.id = m.account_id WHERE m.id = ${messageId} AND a.user_id = ${userId} LIMIT 1` as any[];
    if (!found || !found[0]) throw new NotFoundException('Message not found');
    await this.prisma.$queryRaw`
      UPDATE messages SET archived = ${archived}, updated_at = now() WHERE id = ${messageId}`;
    try {
      await publishNotification({ type: 'message.updated', userId, messageId, changes: { archived } });
    } catch (e) { console.warn('notify publish failed', (e as any)?.message || e); }
    return { ok: true };
  }

  // List attachments metadata for a message
  async listAttachments(userId: string, messageId: string) {
    const found = await this.prisma.$queryRaw`
      SELECT m.id FROM messages m JOIN accounts a ON a.id = m.account_id WHERE m.id = ${messageId} AND a.user_id = ${userId} LIMIT 1` as any[];
    if (!found || !found[0]) throw new NotFoundException('Message not found');

    const rows = await this.prisma.attachment.findMany({
      where: { messageId },
      select: { id: true, filename: true, contentType: true, sizeBytes: true, contentId: true }
    });
    return rows || [];
  }

  // Retrieve attachment content
  async getAttachment(userId: string, messageId: string, attachmentId: string) {
    // verify message belongs to user
    const found = await this.prisma.$queryRaw`
      SELECT m.id, m.raw FROM messages m JOIN accounts a ON a.id = m.account_id WHERE m.id = ${messageId} AND a.user_id = ${userId} LIMIT 1` as any[];
    if (!found || !found[0]) throw new NotFoundException('Message not found');
    const messageRow = found[0];

    const at = await this.prisma.attachment.findFirst({ where: { id: attachmentId, messageId } });
    if (!at) throw new NotFoundException('Attachment not found');

    // if storedPath exists in future we can stream from disk; for now parse raw email and find matching attachment by sha256
    if (!messageRow.raw) throw new NotFoundException('No raw message available to retrieve attachment');

    const rawBuf = Buffer.isBuffer(messageRow.raw) ? messageRow.raw : Buffer.from(messageRow.raw as Uint8Array);
    const parsed = await simpleParser(Readable.from(rawBuf));
    const parsedAt = (parsed.attachments || []).find(p => {
      try {
        const shaParsed = crypto.createHash('sha256').update(p.content).digest();
        const dbSha = at.sha256 ? Buffer.from(at.sha256 as Buffer) : null;
        if (dbSha && Buffer.isBuffer(dbSha) && dbSha.equals(shaParsed)) return true;
      } catch (_) {}

      if (p.cid && at.contentId && p.cid === at.contentId) return true;
      if (p.filename && at.filename && p.filename === at.filename) return true;
      // fallback size compare
      if (typeof p.size === 'number' && typeof at.sizeBytes === 'number' && p.size === at.sizeBytes) return true;
      return false;
    });

    if (!parsedAt) throw new NotFoundException('Attachment content not found in message');

    return { buffer: parsedAt.content, filename: parsedAt.filename || at.filename || 'attachment', contentType: parsedAt.contentType || at.contentType || 'application/octet-stream' };
  }

  async markAllRead(userId: string, mailboxId: string, category?: string | null) {
    const rows = await this.prisma.$queryRaw`
      WITH target AS (
        SELECT m.id
        FROM messages m
        JOIN accounts a ON a.id = m.account_id
        LEFT JOIN ai_metadata am ON am.message_id = m.id AND am.version = 1
        WHERE a.user_id = ${userId}
          AND m.mailbox_id = ${mailboxId}
          AND m.archived = false
          AND m.read = false
          AND (${category}::text IS NULL OR COALESCE(am.labels->>'category','other') = ${category})
      )
      UPDATE messages
      SET "read" = true, updated_at = now()
      WHERE id IN (SELECT id FROM target)
      RETURNING id` as any[];
    return { ok: true, updated: rows?.length || 0 };
  }

  async archiveAll(userId: string, mailboxId: string, category?: string | null) {
    const rows = await this.prisma.$queryRaw`
      WITH target AS (
        SELECT m.id
        FROM messages m
        JOIN accounts a ON a.id = m.account_id
        LEFT JOIN ai_metadata am ON am.message_id = m.id AND am.version = 1
        WHERE a.user_id = ${userId}
          AND m.mailbox_id = ${mailboxId}
          AND m.archived = false
          AND (${category}::text IS NULL OR COALESCE(am.labels->>'category','other') = ${category})
      )
      UPDATE messages
      SET archived = true, updated_at = now()
      WHERE id IN (SELECT id FROM target)
      RETURNING id` as any[];
    return { ok: true, updated: rows?.length || 0 };
  }

  // Send an outgoing message using account SMTP credentials.
  async sendMail(userId: string, payload: any) {
    const { accountId, to, cc, bcc, subject, body, html } = payload || {};
    if (!to || !to.trim()) throw new Error('recipient required');

    // Determine account to send from
    let account: any = null;
    if (accountId) {
      account = await this.prisma.account.findFirst({ where: { id: accountId, userId } });
    } else {
      account = await this.prisma.account.findFirst({ where: { userId } });
    }
    if (!account) throw new NotFoundException('Account to send from not found');

    // decrypt credentials for SMTP settings
    let creds: any = {};
    try {
      creds = decryptJson(account.encryptedCredentials);
    } catch (e) { creds = {}; }

    const host = creds.smtpHost;
    const port = creds.smtpPort || 587;
    const secure = typeof creds.smtpSecure !== 'undefined' ? creds.smtpSecure : true;
    const user = creds.smtpUser;
    const pass = creds.smtpPass;

    if (!host || !user || !pass) throw new Error('SMTP configuration (smtpHost, smtpUser, smtpPass) missing for account');

    const transport = nodemailer.createTransport({ host, port, secure, auth: { user, pass } });

    const mailOptions: any = {
      from: account.email,
      to,
      subject: subject || '',
    };
    if (cc) mailOptions.cc = cc;
    if (bcc) mailOptions.bcc = bcc;
    if (html) { mailOptions.html = html; if (!body) mailOptions.text = undefined; }
    if (body) mailOptions.text = body;

    const info = await transport.sendMail(mailOptions);
    // Persist sent message to Sent mailbox for this account
    try {
      // find or create Sent mailbox for this account
      let mailbox = await this.prisma.mailbox.findFirst({ where: { accountId: account.id, path: 'Sent' } });
      if (!mailbox) {
        mailbox = await this.prisma.mailbox.create({ data: { accountId: account.id, name: 'Sent', path: 'Sent' } });
      }

      const now = new Date();
      const toHeader = Array.isArray(to) ? to : String(to).split(',').map((s: string) => ({ address: s.trim() }));
      const ccHeader = cc ? (Array.isArray(cc) ? cc : String(cc).split(',').map((s: string) => ({ address: s.trim() }))) : null;
      const bccHeader = bcc ? (Array.isArray(bcc) ? bcc : String(bcc).split(',').map((s: string) => ({ address: s.trim() }))) : null;

      const created = await this.prisma.message.create({
        data: {
          accountId: account.id,
          mailboxId: mailbox.id,
          subject: subject || null,
          fromHeader: { name: null, address: account.email },
          toHeader: toHeader as any,
          ccHeader: ccHeader as any,
          bccHeader: bccHeader as any,
          internalDate: now,
          flags: ['\\Seen'],
        }
      });

      // mark message as read flag in separate query to avoid prisma typing mismatch
      try {
        await this.prisma.$queryRaw`UPDATE messages SET "read" = true WHERE id = ${created.id}`;
      } catch (_) {}

      // optionally store a MessageVersion with raw content if html/text provided
      try {
        const rawBuf = Buffer.from(`From: ${account.email}\nTo: ${to}\nSubject: ${subject || ''}\n\n${html || body || ''}`);
        await this.prisma.messageVersion.create({ data: { messageId: created.id, version: 1, raw: rawBuf, reason: 'sent' } });
      } catch (_) {}
    } catch (e) {
      console.warn('persist sent message failed', (e as any)?.message || e);
    }

    return { ok: true, info };
  }
}

