require('dotenv/config');
const IORedis = require('ioredis');
const readline = require('readline');

async function confirm(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(prompt, ans => { rl.close(); resolve(ans); }));
}

async function deleteByPattern(redis, pattern) {
  let cursor = '0';
  let deleted = 0;
  do {
    const res = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 1000);
    cursor = res[0];
    const keys = res[1];
    if (keys.length) {
      for (let i = 0; i < keys.length; i += 500) {
        const chunk = keys.slice(i, i + 500);
        try {
          // Try UNLINK where available, fallback to DEL
          if (typeof redis.unlink === 'function') await redis.unlink(...chunk);
          else await redis.del(...chunk);
          deleted += chunk.length;
        } catch (e) {
          console.error('Failed to delete chunk, falling back to per-key DEL', e.message || e);
          for (const k of chunk) {
            try { await redis.del(k); deleted += 1; } catch (_) {}
          }
        }
      }
    }
  } while (cursor !== '0');
  return deleted;
}

(async () => {
  const redisUrl = process.env.REDIS_URL;
  const redisHost = process.env.REDIS_HOST || '127.0.0.1';
  const redisPort = process.env.REDIS_PORT ? Number(process.env.REDIS_PORT) : 6379;
  const connection = redisUrl ? redisUrl : { host: redisHost, port: redisPort };

  const args = process.argv.slice(2);
  const yes = args.includes('--yes') || args.includes('-y');
  const patterns = [];
  for (const a of args) {
    if (a.startsWith('--pattern=')) patterns.push(a.split('=')[1]);
  }
  if (patterns.length === 0) {
    // Default to BullMQ keys
    patterns.push('bull*');
  }

  if (!yes) {
    console.log('This will delete Redis keys matching:', patterns.join(', '));
    const resp = (await confirm('Continue? (y/N) ')) || '';
    if (resp.toLowerCase() !== 'y') {
      console.log('Aborted.');
      process.exit(0);
    }
  }

  const redis = new IORedis(connection, { maxRetriesPerRequest: null });
  try {
    let total = 0;
    for (const p of patterns) {
      console.log('Scanning pattern', p);
      const removed = await deleteByPattern(redis, p);
      console.log(`Removed ${removed} keys for pattern ${p}`);
      total += removed;
    }
    console.log('Done. Total keys removed:', total);
  } catch (err) {
    console.error('Error while clearing keys:', err);
    process.exitCode = 1;
  } finally {
    try { await redis.quit(); } catch (_) { try { await redis.disconnect(); } catch (_) {} }
  }
})();
