import { Injectable, OnModuleDestroy, OnModuleInit, Logger } from '@nestjs/common';
import IORedis, { Redis } from 'ioredis';
import { EventEmitter } from 'events';

@Injectable()
export class NotificationsService extends EventEmitter implements OnModuleInit, OnModuleDestroy {
  private sub: Redis | undefined;
  private readonly logger = new Logger(NotificationsService.name);

  async onModuleInit() {
    this.sub = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', { maxRetriesPerRequest: null });
    try {
      await this.sub.subscribe('notifications');
      this.logger.log('Subscribed to Redis channel: notifications');
      this.sub.on('message', (_channel: string, message: string) => {
        try {
          this.logger.log(`Received raw notification message: ${message}`);
          const data = JSON.parse(message);
          this.emit('notification', data);
        } catch (e) {
          this.logger.warn('failed to parse notification', (e as any)?.message || e);
        }
      });
    } catch (e) {
      this.logger.warn('failed to subscribe to notifications channel', (e as any)?.message || e);
    }
  }

  async onModuleDestroy() {
    try {
      if (this.sub) await this.sub.quit();
    } catch (_) {}
  }
}
