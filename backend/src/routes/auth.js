import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { pool } from '../database/db.js';
import { HttpError } from '../domain.js';
import { verifyPassword } from '../services/password.js';
import { getSettings } from '../services/sla.js';

export const auth = Router();
const credentials = z.object({ email: z.email().max(254).transform(value => value.toLowerCase()), password: z.string().min(1).max(128) });

export async function authenticate(req, _res, next) {
  if (!req.session.userId) throw new HttpError(401, 'Entre para continuar.');
  const { rows: [user] } = await pool.query(`SELECT u.id, u.name, u.email, u.role,
    ARRAY(SELECT team_id FROM team_members WHERE user_id = u.id) AS team_ids FROM users u
    WHERE id = $1 AND active AND auth_version = $2`, [req.session.userId, req.session.authVersion]);
  if (!user) throw new HttpError(401, 'Sua sessão expirou. Entre novamente.');
  req.user = user;
  next();
}

auth.get('/public', (_req, res) => res.json({ demo: process.env.DEMO_MODE === 'true' }));

auth.post('/login', rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, skipSuccessfulRequests: true,
  standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Muitas tentativas. Aguarde 15 minutos.' } }), async (req, res) => {
  const { email, password } = credentials.parse(req.body);
  const { rows: [user] } = await pool.query('SELECT id, password_hash, auth_version FROM users WHERE email = $1 AND active', [email]);
  if (!await verifyPassword(password, user?.password_hash)) throw new HttpError(401, 'E-mail ou senha incorretos.');
  await new Promise((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
  req.session.userId = user.id;
  req.session.authVersion = user.auth_version;
  await new Promise((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
  res.status(204).end();
});

auth.get('/me', authenticate, async (req, res) => {
  const { workspace_name, timezone } = await getSettings(pool);
  res.json({ user: req.user, workspace_name, timezone, demo: process.env.DEMO_MODE === 'true' });
});

auth.post('/logout', async (req, res) => {
  await new Promise((resolve, reject) => req.session.destroy(error => error ? reject(error) : resolve()));
  res.clearCookie('nexus.sid', { path: '/', httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production' });
  res.status(204).end();
});
