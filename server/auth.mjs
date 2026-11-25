import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt);
export const sessionAge = 7 * 24 * 60 * 60;
export const randomToken = () => randomBytes(32).toString('base64url');
export const digest = value => createHash('sha256').update(value).digest('hex');

export async function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const key = await derive(password, salt, 64);
  return `${salt}:${key.toString('hex')}`;
}

export async function verifyPassword(password, hash) {
  const candidate = await hashPassword(password, hash?.split(':')[0] ?? 'unknown-user');
  return Boolean(hash) && equalSecret(candidate, hash);
}

export function equalSecret(candidate, expected) {
  if (typeof candidate !== 'string' || !expected) return false;
  return timingSafeEqual(Buffer.from(digest(candidate), 'hex'), Buffer.from(digest(expected), 'hex'));
}

export function tokenFrom(request) {
  const match = (request.headers.cookie ?? '').match(/(?:^|;\s*)mf_session=([A-Za-z0-9_-]{43})(?:;|$)/);
  return match ? digest(match[1]) : '';
}

export function sessionCookie(token = '') {
  return `mf_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${token ? sessionAge : 0}`;
}
