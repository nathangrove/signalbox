import { WorkerOptions } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { decryptJson } from '../utils/crypto';
import * as nodemailer from 'nodemailer';
import { publishNotification } from '../notifications/redis-pub';
import { ImapFlow } from 'imapflow';
import * as fs from 'fs';
import * as crypto from 'crypto';

// Do not set `connection` here — QueueService will inject the shared connection.
export const outboundWorkerOptions: WorkerOptions = {} as any;

export const outboundJobProcessor = async (job: any) => {
  const prisma = new PrismaService();
  try {
    const { userId, accountId, to, cc, bcc, subject, body, html } = job.data || {};
    console.log(`[outbound] job.start id=${job.id} userId=${userId} accountId=${accountId}`);
    try { await publishNotification({ type: 'outbound.job.started', userId, jobId: job.id }); } catch (_) {}

    if (!userId) throw new Error('userId required for outbound job');
    if (!to || !String(to).trim()) throw new Error('recipient required');

    // determine account to send from
    let account: any = null;
    if (accountId) {
      account = await prisma.account.findFirst({ where: { id: accountId, userId } });
    } else {
      account = await prisma.account.findFirst({ where: { userId } });
    }
    if (!account) throw new Error('Account to send from not found');
    if (account.syncDisabled) {
      console.log('[outbound] account sync disabled, skipping outbound job for account', account.id);
      try { await publishNotification({ type: 'outbound.job.failed', userId, jobId: job.id, reason: 'account-disabled' }); } catch (_) {}
      return { ok: true, skipped: 'sync-disabled' };
    }

    // decrypt creds
    let creds: any = {};
    try {
      creds = decryptJson(account.encryptedCredentials);
    } catch (e) { creds = {}; }

    if (!creds.smtpHost || !creds.smtpUser || !creds.smtpPass) throw new Error('SMTP credentials missing for account');

    const host = creds.smtpHost;
    const port = creds.smtpPort || 587;
    const secure = typeof creds.smtpSecure !== 'undefined' ? creds.smtpSecure : true;
    const user = creds.smtpUser;
    const pass = creds.smtpPass;

    if (!host || !user || !pass) throw new Error('SMTP configuration (smtpHost, smtpUser, smtpPass) missing for account');

    let transport = nodemailer.createTransport({ host, port, secure, auth: { user, pass } });

    const mailOptions: any = {
      from: account.email,
      to,
      subject: subject || ''
    };
    if (cc) mailOptions.cc = cc;
    if (bcc) mailOptions.bcc = bcc;
    if (html) { mailOptions.html = html; if (!body) mailOptions.text = undefined; }
    if (body) mailOptions.text = body;

    // attach files if provided (attachments: [{ path, filename, contentType }])
    if (Array.isArray(job.data.attachments) && job.data.attachments.length) {
      const files = [];
      for (const at of job.data.attachments) {
        try {
          if (!at.path) continue;
          const buffer = fs.readFileSync(at.path);
          files.push({ filename: at.filename || (at.path.split('/').pop()), contentType: at.contentType || 'application/octet-stream', content: buffer });
        } catch (e) {
          console.warn('[outbound] failed to read attachment', at.path, (e as any)?.message || e);
        }
      }
      if (files.length) mailOptions.attachments = files;
    }
    // verify transporter connectivity first to get clearer errors
    let triedFallback = false;
    try {
      await transport.verify();
      console.log(`[outbound] transporter verified for job=${job.id}`);
    } catch (verifyErr) {
      console.error('[outbound] transporter verify failed', (verifyErr as any)?.message || verifyErr);
      // Common cause: wrong TLS/port combination (465 vs 587). If secure was true, try again with secure=false (STARTTLS)
      try { await publishNotification({ type: 'outbound.job.warn', userId, jobId: job.id, warn: 'smtp.verify_failed', detail: String((verifyErr as any)?.message || verifyErr) }); } catch (_) {}
      if (typeof secure === 'boolean' && secure) {
        triedFallback = true;
        console.log('[outbound] attempting fallback with secure=false (STARTTLS)');
        try {
          const altTransport = nodemailer.createTransport({ host, port, secure: false, auth: user && pass ? { user, pass } : undefined });
          await altTransport.verify();
          console.log(`[outbound] alt transporter verified for job=${job.id}`);
          transport.close && transport.close();
          transport = altTransport;
        } catch (altErr) {
          console.error('[outbound] alt transporter verify failed', (altErr as any)?.message || altErr);
          try { await publishNotification({ type: 'outbound.job.failed', userId, jobId: job.id, reason: 'smtp.verify', error: String((altErr as any)?.message || altErr) }); } catch (_) {}
          throw altErr;
        }
      } else {
        try { await publishNotification({ type: 'outbound.job.failed', userId, jobId: job.id, reason: 'smtp.verify', error: String((verifyErr as any)?.message || verifyErr) }); } catch (_) {}
        throw verifyErr;
      }
    }

    let info: any = null;
    try {
      info = await transport.sendMail(mailOptions);
      console.log(`[outbound] job.sent id=${job.id} info=${info?.messageId || info?.response || ''} fallback=${triedFallback}`);
      try { await publishNotification({ type: 'outbound.job.sent', userId, jobId: job.id, info: { messageId: info?.messageId, response: info?.response, fallback: triedFallback } }); } catch (_) {}
    } catch (sendErr) {
      console.error('[outbound] sendMail failed', (sendErr as any)?.message || sendErr);
      try { await publishNotification({ type: 'outbound.job.failed', userId, jobId: job.id, reason: 'smtp.send', error: String((sendErr as any)?.message || sendErr) }); } catch (_) {}
      throw sendErr;
    }

    // Persist sent message to Sent mailbox
    try {
      let mailbox = await prisma.mailbox.findFirst({ where: { accountId: account.id, path: 'Sent' } });
      if (!mailbox) {
        mailbox = await prisma.mailbox.create({ data: { accountId: account.id, name: 'Sent', path: 'Sent' } });
      }

      const now = new Date();
      const toHeader = Array.isArray(to) ? to : String(to).split(',').map((s: string) => ({ address: s.trim() }));
      const ccHeader = cc ? (Array.isArray(cc) ? cc : String(cc).split(',').map((s: string) => ({ address: s.trim() }))) : null;
      const bccHeader = bcc ? (Array.isArray(bcc) ? bcc : String(bcc).split(',').map((s: string) => ({ address: s.trim() }))) : null;

      const created = await prisma.message.create({
        data: {
          accountId: account.id,
          mailboxId: mailbox.id,
          subject: subject || null,
          fromHeader: { name: null, address: account.email },
          toHeader: toHeader as any,
          ccHeader: ccHeader as any,
          bccHeader: bccHeader as any,
          internalDate: now,
          flags: ['\\Seen']
        }
      });

      try {
        await prisma.$queryRaw`UPDATE messages SET "read" = true WHERE id = ${created.id}`;
      } catch (_) {}

      try {
        const rawBuf = Buffer.from(`From: ${account.email}\nTo: ${to}\nSubject: ${subject || ''}\n\n${html || body || ''}`);
        await prisma.messageVersion.create({ data: { messageId: created.id, version: 1, raw: rawBuf, reason: 'sent' } });
        // persist attachments into attachments table, move files to stored_path
        if (Array.isArray(job.data.attachments) && job.data.attachments.length) {
          for (const at of job.data.attachments) {
            try {
              if (!at.path) continue;
              const buffer = fs.readFileSync(at.path);
              const sha = crypto.createHash('sha256').update(buffer).digest();
              const storedPath = at.path; // keep path as stored_path for now
              await prisma.attachment.create({ data: { messageId: created.id, filename: at.filename || (at.path.split('/').pop()), contentType: at.contentType || 'application/octet-stream', sizeBytes: buffer.length, contentId: null, sha256: sha, storedPath } });
            } catch (e) {
              console.warn('[outbound] failed to persist attachment', (e as any)?.message || e);
            }
          }
        }
      } catch (_) {}
    } catch (e) {
      console.warn('[outbound] persist sent message failed', (e as any)?.message || e);
    }

    // publish job completed notification
    try { await publishNotification({ type: 'outbound.job.completed', userId: job.data.userId, jobId: job.id, info }); } catch (_) {}
    // attempt IMAP APPEND to Sent folder if credentials available
    try {
      const creds = decryptJson(account.encryptedCredentials || Buffer.from('{}'));
      const imapHost = creds.imapHost;
      const imapPort = creds.imapPort || 993;
      const imapSecure = typeof creds.imapSecure !== 'undefined' ? creds.imapSecure : true;
      const imapUser = creds.imapUser || account.email;
      const imapPass = creds.imapPass;
      if (imapHost && imapUser && imapPass) {
        const client = new ImapFlow({ host: imapHost, port: imapPort, secure: imapSecure, auth: { user: imapUser, pass: imapPass } });
        await client.connect();
        try {
          const sentBox = (typeof account.config?.sentMailbox === 'string' && account.config.sentMailbox.trim())
            ? account.config.sentMailbox
            : 'Sent';
          const rawBuf = Buffer.from(`From: ${account.email}\nTo: ${to}\nSubject: ${subject || ''}\n\n${html || body || ''}`);
          await client.append(sentBox, rawBuf, ['\\Seen'], new Date());
        } catch (e) {
          console.warn('[outbound] IMAP append failed', (e as any)?.message || e);
        } finally {
          try { await client.logout(); } catch (_) {}
        }
      }
    } catch (e) {
      console.warn('[outbound] imap append error', (e as any)?.message || e);
    }

    return { ok: true, info };
  } finally {
    try { await prisma.$disconnect(); } catch (_) {}
  }
};

export default outboundJobProcessor;
