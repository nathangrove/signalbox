import * as crypto from 'crypto';

const DEFAULT_KEY = 'default-dev-key-32-chars-long!!!';

function getKeyBuffer() {
  const raw = process.env.ENCRYPTION_KEY || DEFAULT_KEY;
  // Derive a 32-byte key regardless of input length
  return crypto.createHash('sha256').update(raw).digest();
}

export function encryptJson(payload: unknown): Buffer {
  const key = getKeyBuffer();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  let encrypted = cipher.update(JSON.stringify(payload), 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return Buffer.concat([iv, Buffer.from(encrypted, 'hex')]);
}

export function decryptJson(encrypted: Uint8Array): any {
  const key = getKeyBuffer();
  const iv = Buffer.from(encrypted.subarray(0, 16));
  const encryptedData = Buffer.from(encrypted.subarray(16));
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  let decrypted = decipher.update(encryptedData.toString('hex'), 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return JSON.parse(decrypted);
}
