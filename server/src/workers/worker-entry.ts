import 'dotenv/config';
import { createFetchWorkerHandler, fetchWorkerOptions } from './fetch.worker';

// minimal worker process to process fetch queue jobs
const { Worker } = require('bullmq');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const IORedis = require('ioredis');

const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', { maxRetriesPerRequest: null });

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) throw new Error('DATABASE_URL is required for worker');

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: dbUrl }) });

const fetchOpts = Object.assign({ connection }, fetchWorkerOptions || {});
const fetchWorker = new Worker('fetch', createFetchWorkerHandler(prisma), fetchOpts);

fetchWorker.on('failed', (job: any, err: Error) => {
  console.error('fetch job failed', job?.id, err);
});

// start IMAP IDLE manager and polling scheduler (fallback)
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { startIdleService } = require('./idle.manager');
  startIdleService(prisma);
} catch (e) {
  console.warn('Failed to start IMAP IDLE manager:', (e as any)?.message || e);
}

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { startPollingScheduler } = require('./polling.scheduler');
  startPollingScheduler(prisma);
} catch (e) {
  console.warn('Failed to start polling scheduler:', (e as any)?.message || e);
}

// also start parse and ai workers using existing processors
let parseWorker: any;
let aiWorker: any;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { parseJobProcessor, parseWorkerOptions } = require('./parse.processor');
  const parseOpts = Object.assign({ connection }, parseWorkerOptions || {});
  parseWorker = new Worker('parse', parseJobProcessor, parseOpts);
  parseWorker.on('failed', (job: any, err: Error) => {
    console.error('parse job failed', job?.id, err);
  });
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { aiJobProcessor, aiWorkerOptions } = require('./ai.processor');
  const aiOpts = Object.assign({ connection }, aiWorkerOptions || {});
  aiWorker = new Worker('ai', aiJobProcessor, aiOpts);
  aiWorker.on('failed', (job: any, err: Error) => {
    console.error('ai job failed', job?.id, err);
  });
  aiWorker.on('stalled', (jobId: any) => {
    console.warn('ai job stalled', jobId);
  });
  aiWorker.on('active', (job: any) => {
    console.log('ai job active', job?.id);
  });
  aiWorker.on('completed', (job: any) => {
    console.log('ai job completed', job?.id);
  });
  console.log('Worker started for fetch, parse, and ai queues');
} catch (e) {
  console.warn('Could not start parse worker:', (e as any)?.message || e);
  console.log('Worker started for fetch queue only');
}
