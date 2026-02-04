import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { MailboxesService } from './mailboxes.service';

@Controller('mailboxes')
export class MailboxesController {
  constructor(private readonly svc: MailboxesService) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  async list(@Req() req: any, @Query('accountId') accountId?: string) {
    const userId = req.user.sub;
    return this.svc.listForUser(userId, accountId);
  }
}
