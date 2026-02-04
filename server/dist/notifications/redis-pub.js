"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.publishNotification = publishNotification;
const ioredis_1 = require("ioredis");
const publisher = new ioredis_1.default(process.env.REDIS_URL || 'redis://localhost:6379', { maxRetriesPerRequest: null });
async function publishNotification(payload) {
    try {
        await publisher.publish('notifications', JSON.stringify(payload));
    }
    catch (e) {
        console.warn('publishNotification failed', e?.message || e);
    }
}
