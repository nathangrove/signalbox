import { WebSocketGateway, WebSocketServer, OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { Logger } from '@nestjs/common';
import { NotificationsService } from './notifications.service';

@WebSocketGateway({ path: '/socket', cors: { origin: '*' } })
export class NotificationsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(NotificationsGateway.name);

  constructor(private jwtService: JwtService, private notifications: NotificationsService) {
    // listen for notifications from Redis and forward to relevant rooms
    this.notifications.on('notification', (data: any) => this.handleNotification(data));
  }

  async handleConnection(client: Socket) {
    try {
      const token = (client.handshake.auth && (client.handshake.auth as any).token) || (client.handshake.query && (client.handshake.query as any).token);
      if (!token) throw new Error('Missing token');
      const payload = this.jwtService.verify(token, { secret: process.env.JWT_SECRET || 'dev-secret' }) as any;
      const userId = payload?.sub;
      if (!userId) throw new Error('Invalid token payload');
      (client as any).data = (client as any).data || {};
      (client as any).data.userId = userId;
      const room = `user:${userId}`;
      await client.join(room);
      this.logger.log(`Socket connected user=${userId} id=${client.id}`);
      this.logger.log(`Socket ${client.id} joined room ${room}`);
    } catch (e) {
      this.logger.warn(`Socket auth failed: ${(e as any)?.message || e}`);
      client.emit('error', 'Authentication failed');
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    const userId = (client as any).data?.userId;
    this.logger.log(`Socket disconnected user=${userId} id=${client.id}`);
  }

  private handleNotification(data: any) {
    try {
      const { userId, type, ...payload } = data || {};
      if (!userId) {
        this.logger.warn(`notification missing userId: ${JSON.stringify(data)}`);
        return;
      }
      const eventName = type || 'notification';
      this.logger.log(`Forwarding notification event=${eventName} userId=${userId} payload=${JSON.stringify(payload)}`);
      this.server.to(`user:${userId}`).emit(eventName, payload);
    } catch (e) {
      this.logger.warn('failed to forward notification', (e as any)?.message || e);
    }
  }
}
