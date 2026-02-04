import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { NotificationsGateway } from './notifications.gateway';
import { publishNotification } from './redis-pub';

@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private gateway: NotificationsGateway) {}

  @Get('debug/sockets')
  getSockets() {
    const server = (this.gateway as any).server as any;
    if (!server) return { ok: false, message: 'gateway not initialized' };

    const sockets = Array.from(server.sockets.sockets.values()).map((s: any) => ({
      id: s.id,
      rooms: Array.from(s.rooms || []),
      userId: s.data?.userId ?? null
    }));

    return { ok: true, sockets };
  }

  @Post('debug/publish')
  async publish(@Body() payload: any) {
    await publishNotification(payload);
    return { ok: true };
  }
}
