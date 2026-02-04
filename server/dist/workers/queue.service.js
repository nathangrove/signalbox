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
exports.QueueService = void 0;
require("dotenv/config");
const common_1 = require("@nestjs/common");
const bullmq_1 = require("bullmq");
const ioredis_1 = require("ioredis");
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
let redisHost = redisUrl;
try {
    const u = new URL(redisUrl);
    redisHost = `${u.hostname}${u.port ? `:${u.port}` : ''}`;
}
catch (_) {
}
console.log(`[queue] Connecting to Redis host=${redisHost}`);
const connection = new ioredis_1.default(redisUrl, {
    maxRetriesPerRequest: null,
});
let QueueService = class QueueService {
    constructor() {
        this.queues = {};
        this.workers = [];
        this.createQueue('fetch');
        this.createQueue('parse');
        this.createQueue('ai');
        this.createQueue('ai-action');
    }
    createQueue(name) {
        const q = new bullmq_1.Queue(name, { connection });
        this.queues[name] = q;
        if (name === 'fetch') {
            return q;
        }
        if (name === 'parse') {
            const { parseJobProcessor, parseWorkerOptions } = require('./parse.processor');
            const opts = Object.assign({ connection }, parseWorkerOptions || {});
            const w = new bullmq_1.Worker(name, parseJobProcessor, opts);
            this.workers.push(w);
        }
        else if (name === 'ai') {
            const { aiJobProcessor, aiWorkerOptions } = require('./ai.processor');
            const opts = Object.assign({ connection }, aiWorkerOptions || {});
            const w = new bullmq_1.Worker(name, aiJobProcessor, opts);
            this.workers.push(w);
        }
        else if (name === 'ai-action') {
            const { aiActionProcessor, aiActionWorkerOptions } = require('./ai.processor');
            const opts = Object.assign({ connection }, aiActionWorkerOptions || {});
            const w = new bullmq_1.Worker(name, aiActionProcessor, opts);
            this.workers.push(w);
        }
        else {
            const w = new bullmq_1.Worker(name, async (job) => {
                console.log(`Processing job ${name}:${job.id}`);
                return {};
            }, { connection });
            this.workers.push(w);
        }
        return q;
    }
    async onModuleDestroy() {
        await Promise.all(this.workers.map(w => w.close()));
        await Promise.all(Object.values(this.queues).map(q => q.close()));
        await connection.quit();
    }
};
exports.QueueService = QueueService;
exports.QueueService = QueueService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [])
], QueueService);
