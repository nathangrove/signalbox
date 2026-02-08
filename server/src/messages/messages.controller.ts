import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { MessagesService } from './messages.service';
import { QueueService } from '../workers/queue.service';

@Controller('messages')
export class MessagesController {
  constructor(private readonly svc: MessagesService, private readonly queueService: QueueService) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  async list(
    @Req() req: any,
    @Query('mailboxId') mailboxId?: string,
    @Query('accountId') accountId?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('q') q?: string,
    @Query('category') category?: string
  ) {
    const userId = req.user.sub;
    if (mailboxId) {
      return this.svc.listForUser(userId, mailboxId, Number(limit || 50), Number(offset || 0), q, category);
    }
    if (accountId) {
      return this.svc.listForUserByAccount(userId, accountId, Number(limit || 50), Number(offset || 0), q, category);
    }
    return [];
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  async get(@Req() req: any, @Param('id') id: string) {
    const userId = req.user.sub;
    return this.svc.getById(userId, id);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/attachments')
  async listAttachments(@Req() req: any, @Param('id') id: string) {
    const userId = req.user.sub;
    return this.svc.listAttachments(userId, id);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/attachments/:attachmentId')
  async downloadAttachment(@Req() req: any, @Param('id') id: string, @Param('attachmentId') attachmentId: string, @Res() res: any) {
    const userId = req.user.sub;
    const data = await this.svc.getAttachment(userId, id, attachmentId);
    res.setHeader('Content-Type', data.contentType || 'application/octet-stream');
    const inline = !!(req && req.query && (req.query.inline === '1' || req.query.inline === 'true'));
    res.setHeader('Content-Disposition', inline ? `inline; filename="${encodeURIComponent(data.filename || 'attachment')}"` : `attachment; filename="${encodeURIComponent(data.filename || 'attachment')}"`);
    res.setHeader('Content-Length', String(data.buffer.length));
    res.send(data.buffer);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/ai')
  async enqueueAi(@Req() req: any, @Param('id') id: string) {
    const userId = req.user.sub;
    return this.svc.enqueueAiForMessage(userId, id);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/labels')
  async updateLabels(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    const userId = req.user.sub;
    const category = body && typeof body.category === 'string' ? (body.category.trim() || null) : (body && body.category === null ? null : undefined);
    const spam = body && typeof body.spam === 'boolean' ? body.spam : (body && body.spam === null ? null : undefined);
    return this.svc.updateAiLabels(userId, id, { category, spam });
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/read')
  async markRead(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    const userId = req.user.sub;
    const read = body && typeof body.read === 'boolean' ? body.read : true;
    return this.svc.markRead(userId, id, read);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/archive')
  async setArchived(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    const userId = req.user.sub;
    const archived = body && typeof body.archived === 'boolean' ? body.archived : true;
    return this.svc.setArchived(userId, id, archived);
  }

  @UseGuards(JwtAuthGuard)
  @Post('bulk-read')
  async markAllRead(@Req() req: any, @Body() body: any) {
    const userId = req.user.sub;
    const mailboxId = body && typeof body.mailboxId === 'string' ? body.mailboxId : null;
    const accountId = body && typeof body.accountId === 'string' ? body.accountId : null;
    if (!mailboxId && !accountId) throw new BadRequestException('mailboxId or accountId is required');
    const category = body && typeof body.category === 'string' && body.category.trim() ? body.category.trim() : null;
    if (mailboxId) return this.svc.markAllRead(userId, mailboxId, category);
    return this.svc.markAllReadByAccount(userId, accountId, category);
  }

  @UseGuards(JwtAuthGuard)
  @Post('bulk-archive')
  async archiveAll(@Req() req: any, @Body() body: any) {
    const userId = req.user.sub;
    const mailboxId = body && typeof body.mailboxId === 'string' ? body.mailboxId : null;
    const accountId = body && typeof body.accountId === 'string' ? body.accountId : null;
    if (!mailboxId && !accountId) throw new BadRequestException('mailboxId or accountId is required');
    const category = body && typeof body.category === 'string' && body.category.trim() ? body.category.trim() : null;
    if (mailboxId) return this.svc.archiveAll(userId, mailboxId, category);
    return this.svc.archiveAllByAccount(userId, accountId, category);
  }

  @UseGuards(JwtAuthGuard)
  @Post('send')
  async send(@Req() req: any, @Body() body: any) {
    const userId = req.user.sub;
    // Enqueue outbound send job for reliability and retry handling
    const q = this.queueService.queues['outbound'];
    if (!q) {
      // Fallback to synchronous send if queue not available
      return this.svc.sendMail(userId, body);
    }
    const job = await q.add('send', Object.assign({ userId }, body), { attempts: 5, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: true, removeOnFail: false });
    return { ok: true, queued: true, jobId: job.id };
  }
}
