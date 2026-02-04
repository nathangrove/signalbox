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
exports.ImapFetcherService = void 0;
const common_1 = require("@nestjs/common");
const ioredis_1 = require("ioredis");
const prisma_service_1 = require("../prisma/prisma.service");
const imapflow_1 = require("imapflow");
const crypto_1 = require("../utils/crypto");
const connection = new ioredis_1.default(process.env.REDIS_URL || 'redis://localhost:6379', { maxRetriesPerRequest: null });
const IMAP_DEBUG = (process.env.IMAP_DEBUG || 'false') === 'true';
const IMAP_LOGGER = IMAP_DEBUG ? console : { debug: () => { }, info: () => { }, warn: () => { }, error: () => { } };
let ImapFetcherService = class ImapFetcherService {
    constructor(prisma) {
        this.prisma = prisma;
        const { Queue: Q } = require('bullmq');
        this.fetchQueue = new Q('fetch', { connection });
    }
    async fetchAccountHeaders(accountId) {
        const account = await this.prisma.account.findUnique({ where: { id: accountId } });
        if (!account)
            throw new Error('account not found');
        let cfg = account.config || {};
        if ((!cfg.host || !cfg.user || !cfg.pass) && account.encryptedCredentials && account.encryptedCredentials.length) {
            try {
                cfg = (0, crypto_1.decryptJson)(account.encryptedCredentials);
            }
            catch (err) {
                console.error('failed to decrypt account credentials', account.id, err);
            }
        }
        const host = cfg.host || process.env.IMAP_HOST;
        const port = cfg.port || 993;
        const secure = cfg.secure !== undefined ? cfg.secure : true;
        const user = cfg.user;
        const pass = cfg.pass;
        if (!host || !user || !pass) {
            throw new Error('missing imap credentials');
        }
        const client = new imapflow_1.ImapFlow({
            host,
            port,
            secure,
            auth: { user, pass },
            logger: IMAP_LOGGER
        });
        await client.connect();
        try {
            for await (const mailbox of await client.listMailboxes()) {
                if (mailbox.flags && mailbox.flags.includes('\\Noselect'))
                    continue;
                await client.mailboxOpen(mailbox.path, { readOnly: true });
                const lock = await client.getMailboxLock(mailbox.path);
                try {
                    for await (const message of client.fetch('1:*', { envelope: true }, { uid: true })) {
                        await this.fetchQueue.add('parse-header', {
                            accountId,
                            mailbox: mailbox.path,
                            uid: message.uid,
                            seq: message.seq,
                            envelope: message.envelope,
                        });
                    }
                }
                finally {
                    lock.release();
                }
            }
        }
        finally {
            await client.logout();
        }
    }
    async onModuleDestroy() {
        await connection.quit();
    }
};
exports.ImapFetcherService = ImapFetcherService;
exports.ImapFetcherService = ImapFetcherService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], ImapFetcherService);
