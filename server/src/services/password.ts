import argon2 from 'argon2';
import { config } from '../config.js';
import { badRequest } from '../utils/errors.js';

// Argon2id with OWASP-recommended minimum cost parameters.
const OPTIONS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (plain: string) => argon2.hash(plain, OPTIONS);

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

// Verified against when a username does not exist, so timing does not reveal valid usernames.
export const DUMMY_HASH_PROMISE = hashPassword('not-a-real-password-for-timing-only');

const COMMON = new Set([
  'password', 'password1', 'password123', 'qwerty123', '1234567890', '123456789012', 'letmein123',
  'welcome123', 'admin12345', 'hospital123', 'changeme123', 'iloveyou123',
]);

export function assertStrongPassword(password: string, context: { username?: string; fullName?: string } = {}) {
  const min = config.PASSWORD_MIN_LENGTH;
  if (typeof password !== 'string' || password.length < min) {
    throw badRequest(`Password must be at least ${min} characters long.`);
  }
  if (password.length > 200) throw badRequest('Password is too long.');
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) throw badRequest('That password is too common. Choose a different one.');
  if (context.username && lower.includes(context.username.toLowerCase()) && context.username.length >= 3) {
    throw badRequest('Password must not contain your username.');
  }
  if (new Set(password).size < 5) throw badRequest('Password is too repetitive.');
}
