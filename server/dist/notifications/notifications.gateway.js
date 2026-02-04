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
var NotificationsGateway_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotificationsGateway = void 0;
const websockets_1 = require("@nestjs/websockets");
const socket_io_1 = require("socket.io");
const jwt_1 = require("@nestjs/jwt");
const common_1 = require("@nestjs/common");
const notifications_service_1 = require("./notifications.service");
let NotificationsGateway = NotificationsGateway_1 = class NotificationsGateway {
    constructor(jwtService, notifications) {
        this.jwtService = jwtService;
        this.notifications = notifications;
        this.logger = new common_1.Logger(NotificationsGateway_1.name);
        this.notifications.on('notification', (data) => this.handleNotification(data));
    }
    async handleConnection(client) {
        try {
            const token = (client.handshake.auth && client.handshake.auth.token) || (client.handshake.query && client.handshake.query.token);
            if (!token)
                throw new Error('Missing token');
            const payload = this.jwtService.verify(token, { secret: process.env.JWT_SECRET || 'dev-secret' });
            const userId = payload?.sub;
            if (!userId)
                throw new Error('Invalid token payload');
            client.data = client.data || {};
            client.data.userId = userId;
            const room = `user:${userId}`;
            await client.join(room);
            this.logger.log(`Socket connected user=${userId} id=${client.id}`);
            this.logger.log(`Socket ${client.id} joined room ${room}`);
        }
        catch (e) {
            this.logger.warn(`Socket auth failed: ${e?.message || e}`);
            client.emit('error', 'Authentication failed');
            client.disconnect(true);
        }
    }
    handleDisconnect(client) {
        const userId = client.data?.userId;
        this.logger.log(`Socket disconnected user=${userId} id=${client.id}`);
    }
    handleNotification(data) {
        try {
            const { userId, type, ...payload } = data || {};
            if (!userId) {
                this.logger.warn(`notification missing userId: ${JSON.stringify(data)}`);
                return;
            }
            const eventName = type || 'notification';
            this.logger.log(`Forwarding notification event=${eventName} userId=${userId} payload=${JSON.stringify(payload)}`);
            this.server.to(`user:${userId}`).emit(eventName, payload);
        }
        catch (e) {
            this.logger.warn('failed to forward notification', e?.message || e);
        }
    }
};
exports.NotificationsGateway = NotificationsGateway;
__decorate([
    (0, websockets_1.WebSocketServer)(),
    __metadata("design:type", socket_io_1.Server)
], NotificationsGateway.prototype, "server", void 0);
exports.NotificationsGateway = NotificationsGateway = NotificationsGateway_1 = __decorate([
    (0, websockets_1.WebSocketGateway)({ path: '/socket', cors: { origin: '*' } }),
    __metadata("design:paramtypes", [jwt_1.JwtService, notifications_service_1.NotificationsService])
], NotificationsGateway);
