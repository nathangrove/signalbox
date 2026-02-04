"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var NotificationsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotificationsService = void 0;
const common_1 = require("@nestjs/common");
const ioredis_1 = require("ioredis");
const events_1 = require("events");
let NotificationsService = NotificationsService_1 = class NotificationsService extends events_1.EventEmitter {
    constructor() {
        super(...arguments);
        this.logger = new common_1.Logger(NotificationsService_1.name);
    }
    async onModuleInit() {
        this.sub = new ioredis_1.default(process.env.REDIS_URL || 'redis://localhost:6379', { maxRetriesPerRequest: null });
        try {
            await this.sub.subscribe('notifications');
            this.logger.log('Subscribed to Redis channel: notifications');
            this.sub.on('message', (_channel, message) => {
                try {
                    this.logger.log(`Received raw notification message: ${message}`);
                    const data = JSON.parse(message);
                    this.emit('notification', data);
                }
                catch (e) {
                    this.logger.warn('failed to parse notification', e?.message || e);
                }
            });
        }
        catch (e) {
            this.logger.warn('failed to subscribe to notifications channel', e?.message || e);
        }
    }
    async onModuleDestroy() {
        try {
            if (this.sub)
                await this.sub.quit();
        }
        catch (_) { }
    }
};
exports.NotificationsService = NotificationsService;
exports.NotificationsService = NotificationsService = NotificationsService_1 = __decorate([
    (0, common_1.Injectable)()
], NotificationsService);
