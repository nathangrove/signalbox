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
Object.defineProperty(exports, "__esModule", { value: true });
exports.AccountsService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const prisma_service_1 = require("../prisma/prisma.service");
const queue_service_1 = require("../workers/queue.service");
const crypto_1 = require("../utils/crypto");
let AccountsService = class AccountsService {
    constructor(prisma, queueService) {
        this.prisma = prisma;
        this.queueService = queueService;
    }
    encryptConfig(config) {
        return (0, crypto_1.encryptJson)(config);
    }
    decryptConfig(encrypted) {
        return (0, crypto_1.decryptJson)(encrypted);
    }
    async listForUser(userId) {
        const accounts = await this.prisma.account.findMany({ where: { userId } });
        return accounts.map(account => ({
            ...account,
            config: account.encryptedCredentials && account.encryptedCredentials.length
                ? this.decryptConfig(account.encryptedCredentials)
                : {},
        }));
    }
    async createForUser(userId, data) {
        const { config, ...rest } = data;
        const encryptedCredentials = config ? this.encryptConfig(config) : Buffer.alloc(0);
        let account;
        try {
            account = await this.prisma.account.create({
                data: {
                    userId,
                    ...rest,
                    encryptedCredentials,
                    config: {},
                },
            });
        }
        catch (e) {
            if (e instanceof client_1.Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
                throw new common_1.ConflictException('An account with that email already exists');
            }
            throw e;
        }
        await this.queueService.queues.fetch.add('fetch-account', { accountId: account.id }, { removeOnComplete: true, removeOnFail: false });
        return account;
    }
    async syncAccount(userId, accountId) {
        const account = await this.prisma.account.findFirst({ where: { id: accountId, userId } });
        if (!account)
            throw new common_1.ConflictException('Account not found');
        await this.queueService.queues.fetch.add('fetch-account', { accountId: account.id }, { removeOnComplete: true, removeOnFail: false });
        return { ok: true };
    }
};
exports.AccountsService = AccountsService;
exports.AccountsService = AccountsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        queue_service_1.QueueService])
], AccountsService);
