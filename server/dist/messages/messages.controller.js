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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MessagesController = void 0;
const common_1 = require("@nestjs/common");
const jwt_auth_guard_1 = require("../auth/jwt-auth.guard");
const messages_service_1 = require("./messages.service");
let MessagesController = class MessagesController {
    constructor(svc) {
        this.svc = svc;
    }
    async list(req, mailboxId, limit, offset, q, category) {
        if (!mailboxId)
            return [];
        const userId = req.user.sub;
        return this.svc.listForUser(userId, mailboxId, Number(limit || 50), Number(offset || 0), q, category);
    }
    async get(req, id) {
        const userId = req.user.sub;
        return this.svc.getById(userId, id);
    }
    async listAttachments(req, id) {
        const userId = req.user.sub;
        return this.svc.listAttachments(userId, id);
    }
    async downloadAttachment(req, id, attachmentId, res) {
        const userId = req.user.sub;
        const data = await this.svc.getAttachment(userId, id, attachmentId);
        res.setHeader('Content-Type', data.contentType || 'application/octet-stream');
        const inline = !!(req && req.query && (req.query.inline === '1' || req.query.inline === 'true'));
        res.setHeader('Content-Disposition', inline ? `inline; filename="${encodeURIComponent(data.filename || 'attachment')}"` : `attachment; filename="${encodeURIComponent(data.filename || 'attachment')}"`);
        res.setHeader('Content-Length', String(data.buffer.length));
        res.send(data.buffer);
    }
    async enqueueAi(req, id) {
        const userId = req.user.sub;
        return this.svc.enqueueAiForMessage(userId, id);
    }
    async markRead(req, id, body) {
        const userId = req.user.sub;
        const read = body && typeof body.read === 'boolean' ? body.read : true;
        return this.svc.markRead(userId, id, read);
    }
    async setArchived(req, id, body) {
        const userId = req.user.sub;
        const archived = body && typeof body.archived === 'boolean' ? body.archived : true;
        return this.svc.setArchived(userId, id, archived);
    }
    async markAllRead(req, body) {
        const userId = req.user.sub;
        const mailboxId = body && typeof body.mailboxId === 'string' ? body.mailboxId : null;
        if (!mailboxId)
            throw new common_1.BadRequestException('mailboxId is required');
        const category = body && typeof body.category === 'string' && body.category.trim() ? body.category.trim() : null;
        return this.svc.markAllRead(userId, mailboxId, category);
    }
    async archiveAll(req, body) {
        const userId = req.user.sub;
        const mailboxId = body && typeof body.mailboxId === 'string' ? body.mailboxId : null;
        if (!mailboxId)
            throw new common_1.BadRequestException('mailboxId is required');
        const category = body && typeof body.category === 'string' && body.category.trim() ? body.category.trim() : null;
        return this.svc.archiveAll(userId, mailboxId, category);
    }
    async send(req, body) {
        const userId = req.user.sub;
        return this.svc.sendMail(userId, body);
    }
};
exports.MessagesController = MessagesController;
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Get)(),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)('mailboxId')),
    __param(2, (0, common_1.Query)('limit')),
    __param(3, (0, common_1.Query)('offset')),
    __param(4, (0, common_1.Query)('q')),
    __param(5, (0, common_1.Query)('category')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String, String, String]),
    __metadata("design:returntype", Promise)
], MessagesController.prototype, "list", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Get)(':id'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], MessagesController.prototype, "get", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Get)(':id/attachments'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], MessagesController.prototype, "listAttachments", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Get)(':id/attachments/:attachmentId'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Param)('attachmentId')),
    __param(3, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", Promise)
], MessagesController.prototype, "downloadAttachment", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Post)(':id/ai'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], MessagesController.prototype, "enqueueAi", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Post)(':id/read'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], MessagesController.prototype, "markRead", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Post)(':id/archive'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], MessagesController.prototype, "setArchived", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Post)('bulk-read'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], MessagesController.prototype, "markAllRead", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Post)('bulk-archive'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], MessagesController.prototype, "archiveAll", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Post)('send'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], MessagesController.prototype, "send", null);
exports.MessagesController = MessagesController = __decorate([
    (0, common_1.Controller)('messages'),
    __metadata("design:paramtypes", [messages_service_1.MessagesService])
], MessagesController);
