/**
 * Password hashing / verification — Phase 1
 * Uses Node.js built-in crypto.scrypt (no extra dependency).
 * Spec: docs/09-security.md (modern algorithm; bcrypt/Argon2 preferred when available).
 * scrypt is memory-hard and sufficient for MVP; avoids native addons under constrained env.
 */
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

const SALT_LEN = 16;
const KEY_LEN = 64;
const SCRYPT_OPTS = { N: 16384, r: 8, p: 1 } as const;

/**
 * Hash a plaintext password.
 * Returns a single string: `saltHex:keyHex` for storage in users.password_hash.
 */
export async function hashPassword(plaintext: string): Promise<string> {
  if (!plaintext || plaintext.length < 8) {
    throw new Error('Password must be at least 8 characters');
  }
  const salt = randomBytes(SALT_LEN);
  const key = (await scryptAsync(plaintext, salt, KEY_LEN, SCRYPT_OPTS)) as Buffer;
  return `${salt.toString('hex')}:${key.toString('hex')}`;
}

/**
 * Verify plaintext against a stored hash (salt:key).
 * Constant-time comparison.
 */
export async function verifyPassword(plaintext: string, stored: string): Promise<boolean> {
  const parts = stored.split(':');
  if (parts.length !== 2) return false;
  const [saltHex, keyHex] = parts;
  if (!saltHex || !keyHex) return false;
  try {
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(keyHex, 'hex');
    const actual = (await scryptAsync(plaintext, salt, expected.length, SCRYPT_OPTS)) as Buffer;
    if (actual.length !== expected.length) return false;
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
