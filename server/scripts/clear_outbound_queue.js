const IORedis = require('ioredis');
const url = process.env.REDIS_URL || 'redis://localhost:6379';
const redis = new IORedis(url, { maxRetriesPerRequest: null });

(async () => {
  try {
    console.log('Connecting to', url);
    const keys = await redis.keys('bull:outbound*');
    if (!keys || keys.length === 0) {
      console.log('No outbound keys found');
      await redis.quit();
      return;
    }
    console.log('Found keys:', keys);
    const delCount = await redis.del(...keys);
    console.log('Deleted keys count:', delCount);
    await redis.quit();
  } catch (e) {
    console.error('Error clearing outbound queue:', e.message || e);
    try { await redis.quit(); } catch (_) {}
    process.exit(1);
  }
})();
