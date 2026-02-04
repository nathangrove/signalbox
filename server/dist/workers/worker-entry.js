"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const fetch_worker_1 = require("./fetch.worker");
const { Worker } = require('bullmq');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const IORedis = require('ioredis');
const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', { maxRetriesPerRequest: null });
const dbUrl = process.env.DATABASE_URL;
if (!dbUrl)
    throw new Error('DATABASE_URL is required for worker');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: dbUrl }) });
const fetchWorker = new Worker('fetch', (0, fetch_worker_1.createFetchWorkerHandler)(prisma), { connection });
fetchWorker.on('failed', (job, err) => {
    console.error('fetch job failed', job?.id, err);
});
try {
    const { startIdleService } = require('./idle.manager');
    startIdleService(prisma);
}
catch (e) {
    console.warn('Failed to start IMAP IDLE manager:', e?.message || e);
}
try {
    const { startPollingScheduler } = require('./polling.scheduler');
    startPollingScheduler(prisma);
}
catch (e) {
    console.warn('Failed to start polling scheduler:', e?.message || e);
}
let parseWorker;
let aiWorker;
try {
    const { parseJobProcessor, parseWorkerOptions } = require('./parse.processor');
    const parseOpts = Object.assign({ connection }, parseWorkerOptions || {});
    parseWorker = new Worker('parse', parseJobProcessor, parseOpts);
    parseWorker.on('failed', (job, err) => {
        console.error('parse job failed', job?.id, err);
    });
    const { aiJobProcessor, aiWorkerOptions } = require('./ai.processor');
    const aiOpts = Object.assign({ connection }, aiWorkerOptions || {});
    aiWorker = new Worker('ai', aiJobProcessor, aiOpts);
    aiWorker.on('failed', (job, err) => {
        console.error('ai job failed', job?.id, err);
    });
    aiWorker.on('stalled', (jobId) => {
        console.warn('ai job stalled', jobId);
    });
    aiWorker.on('active', (job) => {
        console.log('ai job active', job?.id);
    });
    aiWorker.on('completed', (job) => {
        console.log('ai job completed', job?.id);
    });
    console.log('Worker started for fetch, parse, and ai queues');
}
catch (e) {
    console.warn('Could not start parse worker:', e?.message || e);
    console.log('Worker started for fetch queue only');
}
