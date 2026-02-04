import IORedis from 'ioredis';

const publisher = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', { maxRetriesPerRequest: null });

export async function publishNotification(payload: any) {
  try {
    await publisher.publish('notifications', JSON.stringify(payload));
  } catch (e) {
    console.warn('publishNotification failed', (e as any)?.message || e);
  }
}
