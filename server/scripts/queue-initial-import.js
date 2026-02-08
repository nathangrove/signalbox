#!/usr/bin/env node
/*
 * Usage: node queue-initial-import.js <accountId>
 * Enqueues a 'fetch-account' job with reason 'initial-import' on the 'fetch' queue.
 */

require('dotenv').config();
const IORedis = require('ioredis');
const { Queue } = require('bullmq');

async function main() {
  const args = process.argv.slice(2);
  const accountId = args[0];
  if (!accountId) {
    console.error('Usage: node queue-initial-import.js <accountId> [--full] [--days=<n>] [--max=<n>]');
    process.exit(2);
  }

  const opts = {
    full: args.includes('--full'),
    lookbackDays: null,
    maxMessages: null
  };
  for (const a of args.slice(1)) {
    if (a.startsWith('--days=')) opts.lookbackDays = Number(a.split('=')[1]) || null;
    if (a.startsWith('--max=')) opts.maxMessages = Number(a.split('=')[1]) || null;
  }

  const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', { maxRetriesPerRequest: null });
  const fetchQueue = new Queue('fetch', { connection });

  try {
    await fetchQueue.add('fetch-account', { accountId, reason: 'initial-import', full: opts.full, lookbackDays: opts.lookbackDays, maxMessages: opts.maxMessages, reimport: args.includes('--reimport') }, { removeOnComplete: true, removeOnFail: false });
    console.log('Enqueued initial-import for account', accountId);
  } catch (err) {
    console.error('Failed to enqueue job:', err?.message || err);
    process.exitCode = 1;
  } finally {
    try { await fetchQueue.close(); } catch (_) {}
    try { await connection.quit(); } catch (_) {}
  }
}

main();
