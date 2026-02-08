import 'dotenv/config';
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
let redisHost = redisUrl;
try {
  const u = new URL(redisUrl);
  redisHost = `${u.hostname}${u.port ? `:${u.port}` : ''}`;
} catch (_) {
  // leave redisHost as-is if parsing fails
}
console.log(`[queue] Connecting to Redis host=${redisHost}`);

const connection = new IORedis(redisUrl, {
  maxRetriesPerRequest: null,
});

@Injectable()
export class QueueService implements OnModuleDestroy {
  public queues: Record<string, Queue> = {};
  public workers: Worker[] = [];

  constructor() {
    // Create some named queues used by the app
    this.createQueue('fetch');
    this.createQueue('parse');
    this.createQueue('outbound');
    this.createQueue('ai');
    // queue for summary + recommended action jobs
    this.createQueue('ai-action');
  }

  createQueue(name: string) {
    const q = new Queue(name, { connection, defaultJobOptions: { removeOnComplete: true, removeOnFail: false } });
    this.queues[name] = q;
    // Wire specific processors; keep a generic noop for others
    if (name === 'fetch') {
      // Do not start a local noop worker for fetch jobs.
      // Fetch jobs should be processed by the dedicated worker process.
      return q;
    }
    if (name === 'parse') {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { parseJobProcessor, parseWorkerOptions } = require('./parse.processor');
      const opts = Object.assign({ connection }, parseWorkerOptions || {});
      const w = new Worker(name, parseJobProcessor, opts);
      this.workers.push(w);
    } else if (name === 'ai') {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { aiJobProcessor, aiWorkerOptions } = require('./ai.processor');
      const opts = Object.assign({ connection }, aiWorkerOptions || {});
      const w = new Worker(name, aiJobProcessor, opts);
      this.workers.push(w);
    } else if (name === 'ai-action') {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { aiActionProcessor, aiActionWorkerOptions } = require('./ai.processor');
      const opts = Object.assign({ connection }, aiActionWorkerOptions || {});
      const w = new Worker(name, aiActionProcessor, opts);
      this.workers.push(w);
    } else if (name === 'outbound') {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { outboundJobProcessor, outboundWorkerOptions } = require('./outbound.processor');
      const opts = Object.assign({ connection }, outboundWorkerOptions || {});
      const w = new Worker(name, outboundJobProcessor, opts);
      this.workers.push(w);
    } else {
      const w = new Worker(
        name,
        async job => {
          console.log(`Processing job ${name}:${job.id}`);
          return {};
        },
        { connection }
      );
      this.workers.push(w);
    }
    return q;
  }

  async onModuleDestroy() {
    await Promise.all(this.workers.map(w => w.close()));
    await Promise.all(Object.values(this.queues).map(q => q.close()));
    await connection.quit();
  }
}
