import express from 'express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import cors from 'cors';
import helmet from 'helmet';
import multer from 'multer';
import { ZodError } from 'zod';
import { pool } from './database/db.js';
import { auth, authenticate } from './routes/auth.js';
import { tickets } from './routes/tickets.js';
import { analytics } from './routes/analytics.js';
import { directory, management } from './routes/management.js';
import { notifications } from './routes/notifications.js';
import { HttpError } from './domain.js';
import { scanSla } from './services/sla.js';

const secret = process.env.SESSION_SECRET;
if (!secret || secret.length < 32 || secret.startsWith('replace-with')) throw new Error('Defina SESSION_SECRET com pelo menos 32 caracteres aleatórios.');
if (!process.env.DATABASE_URL) throw new Error('Defina DATABASE_URL.');
const origin = new URL(process.env.FRONTEND_ORIGIN || 'http://localhost:3000').origin;
const production = process.env.NODE_ENV === 'production';
if (production && process.env.DEMO_MODE === 'true') throw new Error('Use uma base própria e desative DEMO_MODE em produção.');
const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY_HOPS) app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS));
app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
app.use(cors({ origin: (value, callback) => callback(null, value === origin ? origin : false), credentials: true,
  allowedHeaders: ['Content-Type', 'X-Nexus-Request'], exposedHeaders: ['Content-Disposition'] }));
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    if ((req.get('origin') && req.get('origin') !== origin) || req.get('X-Nexus-Request') !== '1') {
      throw new HttpError(403, 'Origem da requisição inválida.');
    }
  }
  next();
});
app.use('/api', express.json({ limit: '96kb' }));
app.use('/api', session({
  name: 'nexus.sid', secret, store: new (connectPgSimple(session))({ pool, tableName: 'sessions' }),
  saveUninitialized: false, resave: false, cookie: { httpOnly: true, sameSite: 'strict', secure: production, maxAge: 8 * 60 * 60 * 1000 }
}));

app.get('/api/health', async (_req, res) => { await pool.query('SELECT 1'); res.json({ status: 'ok' }); });
app.use('/api/auth', auth);
app.use('/api/tickets', authenticate, tickets);
app.use('/api/analytics', authenticate, analytics);
app.use('/api/directory', authenticate, directory);
app.use('/api/manage', authenticate, management);
app.use('/api/notifications', authenticate, notifications);
app.use((_req, _res, next) => next(new HttpError(404, 'Recurso não encontrado.')));

app.use((error, _req, res, next) => {
  if (res.headersSent) return next(error);
  if (error instanceof HttpError) return res.status(error.status).json({ error: error.message });
  if (error instanceof ZodError) return res.status(422).json({ error: 'Revise os campos informados.', fields: error.issues.map(issue => issue.path.join('.')) });
  if (error instanceof multer.MulterError) return res.status(422).json({ error: 'Envie até quatro arquivos de no máximo 5 MB cada.' });
  if (error.status === 400 || error.status === 413) return res.status(error.status).json({ error: 'O conteúdo da requisição é inválido ou excede o limite.' });
  if (error.code === '23505') return res.status(409).json({ error: 'Já existe um registro com esses dados.' });
  if (error.code === '23503') return res.status(409).json({ error: 'O registro está associado a outros dados ou foi removido.' });
  console.error(error);
  res.status(500).json({ error: 'Não foi possível concluir a operação.' });
});

await pool.query('SELECT 1 FROM settings');
const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? '127.0.0.1';
const server = app.listen(port, host, () => console.log(`Nexus Desk API em http://${host}:${port}/api`));
const scan = () => scanSla().catch(error => console.error('Falha ao verificar SLA', error));
const schedule = setInterval(scan, 30000);
scan();
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  clearInterval(schedule);
  server.close(async () => { await pool.end(); process.exit(0); });
});
