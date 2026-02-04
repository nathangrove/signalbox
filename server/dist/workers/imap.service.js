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
exports.ImapService = void 0;
const common_1 = require("@nestjs/common");
const imapflow_1 = require("imapflow");
const queue_service_1 = require("./queue.service");
const DEFAULT_FETCH_COUNT = 20;
const IMAP_DEBUG = (process.env.IMAP_DEBUG || 'false') === 'true';
const IMAP_LOGGER = IMAP_DEBUG ? console : { debug: () => { }, info: () => { }, warn: () => { }, error: () => { } };
let ImapService = class ImapService {
    constructor(queueService) {
        this.queueService = queueService;
        this.clients = new Map();
    }
    async onModuleInit() {
        const host = process.env.IMAP_HOST;
        const user = process.env.IMAP_USER;
        if (host && user) {
            this.startSyncForEnvAccount().catch(err => console.error('imap sync failed', err));
        }
    }
    async onModuleDestroy() {
        for (const c of this.clients.values()) {
            try {
                await c.logout();
            }
            catch (_) { }
        }
    }
    async startSyncForEnvAccount() {
        const cfg = {
            host: process.env.IMAP_HOST,
            port: process.env.IMAP_PORT ? Number(process.env.IMAP_PORT) : 993,
            secure: (process.env.IMAP_SECURE || 'true') === 'true',
            auth: {
                user: process.env.IMAP_USER,
                pass: process.env.IMAP_PASS || ''
            }
        };
        const accountId = process.env.IMAP_ACCOUNT_ID || 'env-account';
        await this.syncAccount(accountId, cfg);
    }
    async syncAccount(accountId, cfg) {
        const client = new imapflow_1.ImapFlow({
            host: cfg.host,
            port: cfg.port ?? 993,
            secure: cfg.secure ?? true,
            auth: cfg.auth,
            logger: IMAP_LOGGER
        });
        await client.connect();
        this.clients.set(accountId, client);
        try {
            const mailboxPaths = [];
            for await (const mailbox of client.listMailboxes()) {
                const path = mailbox.path || mailbox.name;
                mailboxPaths.push(path);
            }
            console.log(`[sync] performing poll sync for account ${accountId}`);
            const lock = await client.getMailboxLock('INBOX');
            try {
                const mailbox = client.mailbox;
                const exists = mailbox?.exists || 0;
                if (exists === 0)
                    return;
                const start = Math.max(1, exists - DEFAULT_FETCH_COUNT + 1);
                const range = `${start}:${exists}`;
                let enqueued = 0;
                for await (const msg of client.fetch(range, { envelope: true, internalDate: true }, { uid: true })) {
                    const uid = msg.uid;
                    const payload = { accountId, mailbox: 'INBOX', uid };
                    await this.queueService.queues.parse.add('parse-message', payload, { removeOnComplete: true, removeOnFail: false });
                    enqueued += 1;
                }
                console.log(`[sync] enqueued ${enqueued} parse job(s) for account ${accountId} (mailbox INBOX)`);
            }
            finally {
                lock.release();
            }
        }
        finally {
        }
    }
};
exports.ImapService = ImapService;
exports.ImapService = ImapService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [queue_service_1.QueueService])
], ImapService);
