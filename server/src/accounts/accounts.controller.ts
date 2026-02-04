import { Controller, Get, Post, Body, Req, UseGuards, Param, Patch } from '@nestjs/common';
import { AccountsService } from './accounts.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('accounts')
export class AccountsController {
  constructor(private readonly svc: AccountsService) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  async list(@Req() req: any) {
    const userId = req.user.sub;
    return this.svc.listForUser(userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  async create(@Req() req: any, @Body() body: any) {
    const userId = req.user.sub;
    // Accept fields: provider, email, encrypted_credentials (or raw creds for dev)
    return this.svc.createForUser(userId, body);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  async update(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    const userId = req.user.sub;
    return this.svc.updateForUser(userId, id, body);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/sync')
  async sync(@Req() req: any, @Param('id') id: string) {
    const userId = req.user.sub;
    return this.svc.syncAccount(userId, id);
  }
}
