import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt);
const options = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = await derive(password, salt, 64, options);
  return `${salt}:${hash.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  const [salt, encoded] = (stored ?? `${'0'.repeat(32)}:${'0'.repeat(128)}`).split(':');
  const calculated = await derive(password, salt, 64, options);
  return timingSafeEqual(calculated, Buffer.from(encoded, 'hex')) && Boolean(stored);
}
