"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MessagesService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const mailparser_1 = require("mailparser");
const redis_pub_1 = require("../notifications/redis-pub");
const stream_1 = require("stream");
const queue_service_1 = require("../workers/queue.service");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const crypto_1 = require("../utils/crypto");
let MessagesService = class MessagesService {
    constructor(prisma, queueService) {
        this.prisma = prisma;
        this.queueService = queueService;
    }
    async listForUser(userId, mailboxId, limit = 50, offset = 0, query, category) {
        const take = Math.min(Math.max(limit, 1), 200);
        const skip = Math.max(offset, 0);
        const q = query && query.trim() ? `%${query.trim()}%` : null;
        const rows = await this.prisma.$queryRaw `
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
        return rows.map(row => ({
            ...row,
            spam: row.spam === 'true',
            read: row.read === true,
            archived: row.archived === true,
            hasItinerary: row.hasItinerary === true,
            hasTracking: row.hasTracking === true
        }));
    }
    async getById(userId, id) {
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
        const statusRows = await this.prisma.$queryRaw `
      SELECT "read", archived FROM messages WHERE id = ${id} LIMIT 1`;
        const status = statusRows && statusRows[0] ? statusRows[0] : null;
        if (!message)
            throw new common_1.NotFoundException('Message not found');
        let text = null;
        let html = null;
        if (message.raw) {
            const rawBuf = Buffer.isBuffer(message.raw)
                ? message.raw
                : Buffer.from(message.raw);
            const parsed = await (0, mailparser_1.simpleParser)(stream_1.Readable.from(rawBuf));
            text = parsed.text || null;
            html = parsed.html ? String(parsed.html) : null;
        }
        const aiRows = await this.prisma.$queryRaw `
      SELECT labels->>'category' AS "category", labels->>'spam' AS "spam", labels->>'categoryReason' AS "categoryReason", labels->>'cold' AS "cold", summary, action, itinerary, tracking
      FROM ai_metadata WHERE message_id = ${id} AND version = 1 LIMIT 1`;
        const ai = aiRows && aiRows[0] ? aiRows[0] : null;
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
    async enqueueAiForMessage(userId, messageId) {
        const message = await this.prisma.message.findFirst({
            where: { id: messageId, account: { userId } },
            select: { id: true }
        });
        if (!message)
            throw new common_1.NotFoundException('Message not found');
        const insertedAi = await this.prisma.$queryRaw `
      INSERT INTO ai_metadata (message_id, model, provider, created_at)
      VALUES (${messageId}, 'pending', 'local', now())
      ON CONFLICT (message_id, version) DO NOTHING
      RETURNING id`;
        const aiRows = await this.prisma.$queryRaw `
      SELECT id FROM ai_metadata WHERE message_id = ${messageId} AND version = 1 LIMIT 1`;
        const aiMetadataId = (insertedAi && insertedAi[0] && insertedAi[0].id) || (aiRows && aiRows[0] && aiRows[0].id);
        if (aiMetadataId) {
            await this.queueService.queues.ai.add('classify-message', { messageId, aiMetadataId }, { attempts: 3, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: true, removeOnFail: false });
            await this.queueService.queues['ai-action'].add('summarize-action', { messageId, aiMetadataId }, { removeOnComplete: true, removeOnFail: false });
        }
        return { ok: true };
    }
    async markRead(userId, messageId, read = true) {
        const found = await this.prisma.$queryRaw `
      SELECT m.id FROM messages m JOIN accounts a ON a.id = m.account_id WHERE m.id = ${messageId} AND a.user_id = ${userId} LIMIT 1`;
        if (!found || !found[0])
            throw new common_1.NotFoundException('Message not found');
        await this.prisma.$queryRaw `
      UPDATE messages SET "read" = ${read}, updated_at = now() WHERE id = ${messageId}`;
        try {
            await (0, redis_pub_1.publishNotification)({ type: 'message.updated', userId, messageId, changes: { read } });
        }
        catch (e) {
            console.warn('notify publish failed', e?.message || e);
        }
        return { ok: true };
    }
    async setArchived(userId, messageId, archived) {
        const found = await this.prisma.$queryRaw `
      SELECT m.id FROM messages m JOIN accounts a ON a.id = m.account_id WHERE m.id = ${messageId} AND a.user_id = ${userId} LIMIT 1`;
        if (!found || !found[0])
            throw new common_1.NotFoundException('Message not found');
        await this.prisma.$queryRaw `
      UPDATE messages SET archived = ${archived}, updated_at = now() WHERE id = ${messageId}`;
        try {
            await (0, redis_pub_1.publishNotification)({ type: 'message.updated', userId, messageId, changes: { archived } });
        }
        catch (e) {
            console.warn('notify publish failed', e?.message || e);
        }
        return { ok: true };
    }
    async listAttachments(userId, messageId) {
        const found = await this.prisma.$queryRaw `
      SELECT m.id FROM messages m JOIN accounts a ON a.id = m.account_id WHERE m.id = ${messageId} AND a.user_id = ${userId} LIMIT 1`;
        if (!found || !found[0])
            throw new common_1.NotFoundException('Message not found');
        const rows = await this.prisma.attachment.findMany({
            where: { messageId },
            select: { id: true, filename: true, contentType: true, sizeBytes: true, contentId: true }
        });
        return rows || [];
    }
    async getAttachment(userId, messageId, attachmentId) {
        const found = await this.prisma.$queryRaw `
      SELECT m.id, m.raw FROM messages m JOIN accounts a ON a.id = m.account_id WHERE m.id = ${messageId} AND a.user_id = ${userId} LIMIT 1`;
        if (!found || !found[0])
            throw new common_1.NotFoundException('Message not found');
        const messageRow = found[0];
        const at = await this.prisma.attachment.findFirst({ where: { id: attachmentId, messageId } });
        if (!at)
            throw new common_1.NotFoundException('Attachment not found');
        if (!messageRow.raw)
            throw new common_1.NotFoundException('No raw message available to retrieve attachment');
        const rawBuf = Buffer.isBuffer(messageRow.raw) ? messageRow.raw : Buffer.from(messageRow.raw);
        const parsed = await (0, mailparser_1.simpleParser)(stream_1.Readable.from(rawBuf));
        const parsedAt = (parsed.attachments || []).find(p => {
            try {
                const shaParsed = crypto.createHash('sha256').update(p.content).digest();
                const dbSha = at.sha256 ? Buffer.from(at.sha256) : null;
                if (dbSha && Buffer.isBuffer(dbSha) && dbSha.equals(shaParsed))
                    return true;
            }
            catch (_) { }
            if (p.cid && at.contentId && p.cid === at.contentId)
                return true;
            if (p.filename && at.filename && p.filename === at.filename)
                return true;
            if (typeof p.size === 'number' && typeof at.sizeBytes === 'number' && p.size === at.sizeBytes)
                return true;
            return false;
        });
        if (!parsedAt)
            throw new common_1.NotFoundException('Attachment content not found in message');
        return { buffer: parsedAt.content, filename: parsedAt.filename || at.filename || 'attachment', contentType: parsedAt.contentType || at.contentType || 'application/octet-stream' };
    }
    async markAllRead(userId, mailboxId, category) {
        const rows = await this.prisma.$queryRaw `
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
      RETURNING id`;
        return { ok: true, updated: rows?.length || 0 };
    }
    async archiveAll(userId, mailboxId, category) {
        const rows = await this.prisma.$queryRaw `
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
      RETURNING id`;
        return { ok: true, updated: rows?.length || 0 };
    }
    async sendMail(userId, payload) {
        const { accountId, to, cc, bcc, subject, body, html } = payload || {};
        if (!to || !to.trim())
            throw new Error('recipient required');
        let account = null;
        if (accountId) {
            account = await this.prisma.account.findFirst({ where: { id: accountId, userId } });
        }
        else {
            account = await this.prisma.account.findFirst({ where: { userId } });
        }
        if (!account)
            throw new common_1.NotFoundException('Account to send from not found');
        let creds = {};
        try {
            creds = (0, crypto_1.decryptJson)(account.encryptedCredentials);
        }
        catch (e) {
            creds = {};
        }
        const host = creds.smtpHost || creds.host || process.env.SMTP_HOST;
        const port = creds.smtpPort || creds.port || (process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 587);
        const secure = typeof creds.smtpSecure !== 'undefined' ? creds.smtpSecure : (typeof creds.secure !== 'undefined' ? creds.secure : (process.env.SMTP_SECURE === 'true'));
        const user = creds.smtpUser || creds.user || account.email;
        const pass = creds.smtpPass || creds.pass || process.env.SMTP_PASS;
        if (!host || !user)
            throw new Error('SMTP configuration missing for account');
        const transport = nodemailer.createTransport({ host, port, secure, auth: user && pass ? { user, pass } : undefined });
        const mailOptions = {
            from: account.email,
            to,
            subject: subject || '',
        };
        if (cc)
            mailOptions.cc = cc;
        if (bcc)
            mailOptions.bcc = bcc;
        if (html) {
            mailOptions.html = html;
            if (!body)
                mailOptions.text = undefined;
        }
        if (body)
            mailOptions.text = body;
        const info = await transport.sendMail(mailOptions);
        try {
            let mailbox = await this.prisma.mailbox.findFirst({ where: { accountId: account.id, path: 'Sent' } });
            if (!mailbox) {
                mailbox = await this.prisma.mailbox.create({ data: { accountId: account.id, name: 'Sent', path: 'Sent' } });
            }
            const now = new Date();
            const toHeader = Array.isArray(to) ? to : String(to).split(',').map((s) => ({ address: s.trim() }));
            const ccHeader = cc ? (Array.isArray(cc) ? cc : String(cc).split(',').map((s) => ({ address: s.trim() }))) : null;
            const bccHeader = bcc ? (Array.isArray(bcc) ? bcc : String(bcc).split(',').map((s) => ({ address: s.trim() }))) : null;
            const created = await this.prisma.message.create({
                data: {
                    accountId: account.id,
                    mailboxId: mailbox.id,
                    subject: subject || null,
                    fromHeader: { name: null, address: account.email },
                    toHeader: toHeader,
                    ccHeader: ccHeader,
                    bccHeader: bccHeader,
                    internalDate: now,
                    flags: ['\\Seen'],
                }
            });
            try {
                await this.prisma.$queryRaw `UPDATE messages SET "read" = true WHERE id = ${created.id}`;
            }
            catch (_) { }
            try {
                const rawBuf = Buffer.from(`From: ${account.email}\nTo: ${to}\nSubject: ${subject || ''}\n\n${html || body || ''}`);
                await this.prisma.messageVersion.create({ data: { messageId: created.id, version: 1, raw: rawBuf, reason: 'sent' } });
            }
            catch (_) { }
        }
        catch (e) {
            console.warn('persist sent message failed', e?.message || e);
        }
        return { ok: true, info };
    }
};
exports.MessagesService = MessagesService;
exports.MessagesService = MessagesService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        queue_service_1.QueueService])
], MessagesService);
