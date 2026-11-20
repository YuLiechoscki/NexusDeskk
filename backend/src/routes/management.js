import { Router } from 'express';
import { z } from 'zod';
import { DateTime, IANAZone } from 'luxon';
import { pool, transaction } from '../database/db.js';
import { allow, HttpError, priorities, roles, statuses, terminal, ticketScope } from '../domain.js';
import { activity } from '../services/events.js';
import { hashPassword } from '../services/password.js';
import { getSettings, slaStateSql } from '../services/sla.js';

export const directory = Router();
export const management = Router();
const admin = allow('admin');
const staff = allow('admin', 'manager', 'agent');
const numericId = z.number().int().positive().max(2147483647);
const id = z.string().regex(/^\d{1,10}$/).transform(Number).pipe(numericId);
const name = z.string().trim().min(2).max(100);
const entity = z.object({ name, description: z.string().trim().max(500).default(''), active: z.boolean().default(true) });
const userInput = z.object({ name, email: z.email().max(254).transform(value => value.toLowerCase()), role: z.enum(roles),
  password: z.string().min(12).max(128).optional(), active: z.boolean().default(true), team_ids: z.array(numericId).max(50).default([]) });
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => DateTime.fromISO(value).isValid);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

directory.get('/', async (req, res) => {
  const isStaff = req.user.role !== 'requester';
  const [categories, teams, people] = await Promise.all([
    pool.query('SELECT id,name,active FROM categories ORDER BY name'),
    isStaff ? pool.query('SELECT id,name,active FROM teams ORDER BY name') : { rows: [] },
    isStaff ? pool.query(`SELECT u.id,u.name,u.role,ARRAY(SELECT team_id FROM team_members WHERE user_id=u.id) AS team_ids
      FROM users u WHERE u.active AND u.role <> 'requester' ORDER BY u.name`) : { rows: [] }
  ]);
  res.json({ categories: categories.rows, teams: teams.rows, people: people.rows });
});

management.get('/teams', staff, async (req, res) => {
  const params = [req.user.role === 'admin', req.user.team_ids];
  const { rows } = await pool.query(`SELECT tm.*, COALESCE((SELECT json_agg(json_build_object('id',u.id,'name',u.name,'role',u.role) ORDER BY u.name)
    FROM team_members m JOIN users u ON u.id=m.user_id WHERE m.team_id=tm.id AND u.active), '[]') AS members,
    (SELECT count(*)::int FROM tickets WHERE team_id=tm.id AND status NOT IN ('resolved','closed','cancelled')) AS backlog
    FROM teams tm WHERE $1 OR tm.id=ANY($2::integer[]) ORDER BY tm.active DESC,tm.name`, params);
  res.json(rows);
});

management.get('/owners', staff, async (req, res) => {
  const params = [req.user.role === 'admin', req.user.team_ids];
  const scope = ticketScope(req.user, params);
  const { rows } = await pool.query(`SELECT u.id,u.name,u.role,
    ARRAY(SELECT tm.name FROM team_members m JOIN teams tm ON tm.id=m.team_id WHERE m.user_id=u.id ORDER BY tm.name) AS teams,
    (count(t.id) FILTER (WHERE t.status NOT IN ('resolved','closed','cancelled')))::int AS active,
    (count(t.id) FILTER (WHERE t.status IN ('resolved','closed')))::int AS resolved,
    (count(t.id) FILTER (WHERE t.status NOT IN ('resolved','closed','cancelled') AND t.priority='critical'))::int AS critical
    FROM users u LEFT JOIN tickets t ON t.assignee_id=u.id AND ${scope}
    WHERE u.active AND u.role <> 'requester' AND ($1 OR EXISTS (SELECT 1 FROM team_members m WHERE m.user_id=u.id AND m.team_id=ANY($2::integer[])))
    GROUP BY u.id ORDER BY active DESC,u.name`, params);
  res.json(rows);
});

management.get('/categories', admin, async (_req, res) => {
  const { rows } = await pool.query(`SELECT c.*, count(t.id)::int AS tickets FROM categories c LEFT JOIN tickets t ON t.category_id=c.id GROUP BY c.id ORDER BY c.active DESC,c.name`);
  res.json(rows);
});

for (const kind of ['teams', 'categories']) {
  management.post(`/${kind}`, admin, async (req, res) => {
    const item = entity.parse(req.body);
    await transaction(async db => {
      const { rows: [record] } = await db.query(`INSERT INTO ${kind} (name,description,active) VALUES ($1,$2,$3) RETURNING id`, [item.name, item.description, item.active]);
      await activity(db, null, req.user.id, `${kind}_created`, { id: record.id, ...item }, true);
    });
    res.status(201).end();
  });
  management.put(`/${kind}/:id`, admin, async (req, res) => {
    const recordId = id.parse(req.params.id);
    const item = entity.parse(req.body);
    await transaction(async db => {
      const { rows: [before] } = await db.query(`SELECT name,description,active FROM ${kind} WHERE id=$1 FOR UPDATE`, [recordId]);
      if (!before) throw new HttpError(404, 'Registro não encontrado.');
      await db.query(`UPDATE ${kind} SET name=$2,description=$3,active=$4 WHERE id=$1`, [recordId, item.name, item.description, item.active]);
      await activity(db, null, req.user.id, `${kind}_updated`, { id: recordId, before, after: item }, true);
    });
    res.status(204).end();
  });
}

management.get('/users', admin, async (_req, res) => {
  const { rows } = await pool.query(`SELECT u.id,u.name,u.email,u.role,u.active,u.created_at,
    ARRAY(SELECT team_id FROM team_members WHERE user_id=u.id ORDER BY team_id) AS team_ids
    FROM users u ORDER BY u.active DESC,u.name`);
  res.json(rows);
});

async function saveUser(req, res, existingId = null) {
  const { password, ...input } = userInput.parse(req.body);
  if (!existingId && !password) throw new HttpError(422, 'A senha inicial deve ter ao menos 12 caracteres.');
  if (req.user.id === existingId && (!input.active || input.role !== 'admin')) throw new HttpError(422, 'Sua conta deve permanecer como administradora ativa.');
  const teamIds = input.role === 'requester' ? [] : [...new Set(input.team_ids)];
  const hash = password ? await hashPassword(password) : null;
  await transaction(async db => {
    await db.query('SELECT pg_advisory_xact_lock(514034)');
    const actor = await db.query("SELECT 1 FROM users WHERE id=$1 AND role='admin' AND active", [req.user.id]);
    if (!actor.rowCount) throw new HttpError(403, 'Sua conta não pode mais administrar usuários.');
    let userId = existingId;
    let before = null;
    if (userId) {
      ({ rows: [before] } = await db.query(`SELECT id,name,email,role,active,
        ARRAY(SELECT team_id FROM team_members WHERE user_id=$1 ORDER BY team_id) AS team_ids FROM users WHERE id=$1 FOR UPDATE`, [userId]));
      if (!before) throw new HttpError(404, 'Usuário não encontrado.');
      const revoke = Boolean(hash) || before.active !== input.active || before.role !== input.role;
      await db.query(`UPDATE users SET name=$2,email=$3,role=$4,active=$5,password_hash=COALESCE($6,password_hash),
        auth_version=auth_version + $7::integer WHERE id=$1`, [userId, input.name, input.email, input.role, input.active, hash, Number(revoke)]);
    } else {
      const { rows: [user] } = await db.query('INSERT INTO users (name,email,role,active,password_hash) VALUES ($1,$2,$3,$4,$5) RETURNING id',
        [input.name, input.email, input.role, input.active, hash]);
      userId = user.id;
    }
    await db.query('DELETE FROM team_members WHERE user_id=$1', [userId]);
    await db.query('INSERT INTO team_members (user_id,team_id) SELECT $1,unnest($2::integer[])', [userId, teamIds]);
    await activity(db, null, req.user.id, existingId ? 'users_updated' : 'users_created', { id: userId, before, after: { ...input, team_ids: teamIds }, password_changed: Boolean(hash) }, true);
  });
  res.status(existingId ? 204 : 201).end();
}

management.post('/users', admin, (req, res) => saveUser(req, res));
management.put('/users/:id', admin, (req, res) => saveUser(req, res, id.parse(req.params.id)));

management.get('/sla', staff, async (req, res) => {
  const args = [];
  const scope = ticketScope(req.user, args);
  const [settings, policies, holidays, attention, history] = await Promise.all([
    getSettings(pool), pool.query('SELECT * FROM sla_policies ORDER BY priority'), pool.query('SELECT day::text,name FROM holidays ORDER BY day'),
    pool.query(`SELECT * FROM (SELECT t.id,t.code,t.title,t.priority,t.status,t.escalated_at,(${slaStateSql('t')}) AS sla_state
      FROM tickets t WHERE ${scope} AND t.status <> ALL(ARRAY['${terminal.join("','")}']::status_type[])) alert
      WHERE sla_state IN ('breached','warning','paused') ORDER BY escalated_at DESC NULLS LAST,
      CASE sla_state WHEN 'breached' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END,id DESC LIMIT 50`, args),
    pool.query(`SELECT s.phase,s.cycle,s.deadline,s.completed_at,s.breached_at,t.id,t.code,t.title FROM sla_targets s JOIN tickets t ON t.id=s.ticket_id
      WHERE ${scope} AND (s.completed_at IS NOT NULL OR s.breached_at IS NOT NULL)
      ORDER BY COALESCE(s.breached_at,s.completed_at) DESC LIMIT 50`, args)
  ]);
  res.json({ settings, policies: policies.rows, holidays: holidays.rows, attention: attention.rows, history: history.rows });
});

management.put('/sla/policies/:priority', admin, async (req, res) => {
  const priority = z.enum(priorities).parse(req.params.priority);
  const minutes = z.number().int().min(1).max(43200);
  const body = z.object({ response_minutes: minutes, resolution_minutes: minutes }).refine(value => value.resolution_minutes >= value.response_minutes).parse(req.body);
  await transaction(async db => {
    const { rows: [before] } = await db.query('SELECT * FROM sla_policies WHERE priority=$1 FOR UPDATE', [priority]);
    await db.query('UPDATE sla_policies SET response_minutes=$2,resolution_minutes=$3 WHERE priority=$1', [priority, body.response_minutes, body.resolution_minutes]);
    await activity(db, null, req.user.id, 'sla_policy', { priority, before, after: body }, true);
  });
  res.status(204).end();
});

management.get('/settings', admin, async (_req, res) => res.json(await getSettings(pool)));
management.put('/settings', admin, async (req, res) => {
  const settings = z.object({ workspace_name: name, timezone: z.string().max(80).refine(value => IANAZone.isValidZone(value)),
    business_days: z.array(z.number().int().min(1).max(7)).min(1).max(7), business_start: time, business_end: time,
    pause_statuses: z.array(z.enum(statuses.filter(status => !terminal.includes(status) && status !== 'open'))).max(4),
    warning_minutes: z.number().int().min(1).max(10080) }).refine(value => value.business_end > value.business_start).parse(req.body);
  await transaction(async db => {
    await db.query('SELECT id FROM settings FOR UPDATE');
    const before = await getSettings(db);
    await db.query(`UPDATE settings SET workspace_name=$1,timezone=$2,business_days=$3,business_start=$4,business_end=$5,pause_statuses=$6,warning_minutes=$7`,
      [settings.workspace_name, settings.timezone, [...new Set(settings.business_days)], settings.business_start, settings.business_end, [...new Set(settings.pause_statuses)], settings.warning_minutes]);
    await activity(db, null, req.user.id, 'settings_updated', { before, after: settings }, true);
  });
  res.status(204).end();
});

management.post('/sla/holidays', admin, async (req, res) => {
  const holiday = z.object({ day: date, name }).parse(req.body);
  await transaction(async db => {
    await db.query('INSERT INTO holidays (day,name) VALUES ($1,$2)', [holiday.day, holiday.name]);
    await activity(db, null, req.user.id, 'holiday_added', holiday, true);
  });
  res.status(201).end();
});

management.delete('/sla/holidays/:day', admin, async (req, res) => {
  const day = date.parse(req.params.day);
  await transaction(async db => {
    const { rows: [holiday] } = await db.query('DELETE FROM holidays WHERE day=$1 RETURNING day::text,name', [day]);
    if (!holiday) throw new HttpError(404, 'Feriado não encontrado.');
    await activity(db, null, req.user.id, 'holiday_removed', holiday, true);
  });
  res.status(204).end();
});

management.get('/audit', admin, async (req, res) => {
  const page = id.optional().parse(req.query.page) ?? 1;
  const { rows } = await pool.query(`SELECT a.id,a.ticket_id,a.action,a.changes,a.created_at,u.name AS actor,t.code,
    count(*) OVER ()::int AS total FROM activity a LEFT JOIN users u ON u.id=a.actor_id LEFT JOIN tickets t ON t.id=a.ticket_id
    ORDER BY a.created_at DESC,a.id DESC LIMIT 25 OFFSET $1`, [(page - 1) * 25]);
  res.json({ items: rows, page, total: rows[0]?.total ?? 0 });
});
