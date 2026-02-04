"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.encryptJson = encryptJson;
exports.decryptJson = decryptJson;
const crypto = require("crypto");
const DEFAULT_KEY = 'default-dev-key-32-chars-long!!!';
function getKeyBuffer() {
    const raw = process.env.ENCRYPTION_KEY || DEFAULT_KEY;
    return crypto.createHash('sha256').update(raw).digest();
}
function encryptJson(payload) {
    const key = getKeyBuffer();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let encrypted = cipher.update(JSON.stringify(payload), 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return Buffer.concat([iv, Buffer.from(encrypted, 'hex')]);
}
function decryptJson(encrypted) {
    const key = getKeyBuffer();
    const iv = Buffer.from(encrypted.subarray(0, 16));
    const encryptedData = Buffer.from(encrypted.subarray(16));
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(encryptedData.toString('hex'), 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return JSON.parse(decrypted);
}
