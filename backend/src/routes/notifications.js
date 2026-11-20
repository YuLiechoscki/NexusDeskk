import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../database/db.js';
import { ticketScope } from '../domain.js';

export const notifications = Router();
const query = z.object({ page: z.string().regex(/^\d{1,8}$/).transform(Number).pipe(z.number().int().positive()).default(1) });

notifications.get('/', async (req, res) => {
  const { page } = query.parse(req.query);
  const args = [req.user.id, (page - 1) * 50];
  const scope = ticketScope(req.user, args);
  const { rows } = await pool.query(`SELECT n.*, t.code, (count(*) FILTER (WHERE n.read_at IS NULL) OVER ())::int AS unread
    FROM notifications n JOIN tickets t ON t.id=n.ticket_id WHERE n.user_id=$1 AND ${scope}
    ORDER BY n.created_at DESC,n.id DESC LIMIT 51 OFFSET $2`, args);
  res.json({ unread: rows[0]?.unread ?? 0, items: rows.slice(0, 50), has_more: rows.length > 50 });
});

notifications.patch('/read', async (req, res) => {
  const { id } = z.object({ id: z.number().int().positive().optional() }).parse(req.body);
  await pool.query('UPDATE notifications SET read_at=now() WHERE user_id=$1 AND read_at IS NULL AND ($2::integer IS NULL OR id=$2)', [req.user.id, id ?? null]);
  res.status(204).end();
});
