import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { config } from './config.js';

function key(): Buffer {
  if (!config.credEncKeyB64) {
    if (process.env.NODE_ENV === 'production') throw new Error('CRED_ENC_KEY missing in production');
    // Dev-only fallback (never used in prod; tests assert encryption round-trip, not key strength).
    return Buffer.alloc(32, 7);
  }
  const k = Buffer.from(config.credEncKeyB64, 'base64');
  if (k.length !== 32) throw new Error('CRED_ENC_KEY must be base64 of 32 bytes');
  return k;
}

/** AES-256-GCM envelope for user cloud credentials + GitHub tokens. */
export function encryptJson(obj: Record<string, string>): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

export function decryptJson(enc: string): Record<string, string> {
  const raw = Buffer.from(enc, 'base64');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ct = raw.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  return JSON.parse(pt) as Record<string, string>;
}
