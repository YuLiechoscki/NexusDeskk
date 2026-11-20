import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { pool, transaction } from '../database/db.js';
import { HttpError, priorities, statuses, terminal, ticketActions, ticketScope } from '../domain.js';
import { activity, notify } from '../services/events.js';
import { addAttachments, addComment, changeTicket, createTicket, getTicket, ticketSelect } from '../services/tickets.js';

export const tickets = Router();
const id = z.number().int().positive().max(2147483647);
const queryId = z.string().regex(/^\d{1,10}$/).transform(Number).pipe(id);
const title = z.string().trim().min(5).max(160);
const description = z.string().trim().min(10).max(12000);
const priority = z.enum(priorities);
const status = z.enum(statuses);
const input = z.object({ title, description, category_id: queryId.or(id), priority: priority.default('medium') });
const patch = z.strictObject({ title, description, priority, status, category_id: id, team_id: id.nullable(), assignee_id: id.nullable() }).partial();
const upload = multer({ limits: { fileSize: 5 * 1024 * 1024, files: 4, fields: 6, fieldSize: 50000 } }).array('files', 4);
const sorts = { newest: 'created_at DESC', oldest: 'created_at ASC', updated: 'updated_at DESC', priority: 'priority DESC', title: 'title ASC' };
const filters = z.object({
  q: z.string().trim().max(160).optional(), status: status.optional(), priority: priority.optional(),
  assignee_id: queryId.or(z.literal('none')).optional(), category_id: queryId.optional(), team_id: queryId.optional(),
  view: z.enum(['all', 'mine', 'queue']).default('all'), sort: z.enum(Object.keys(sorts)).default('newest'),
  page: queryId.default(1), size: queryId.refine(value => value <= 100).default(10)
});

tickets.get('/', async (req, res) => {
  const options = filters.parse(req.query);
  const params = [];
  const where = [ticketScope(req.user, params)];
  for (const field of ['status', 'priority', 'category_id', 'assignee_id', 'team_id']) {
    const value = options[field];
    if (value === 'none') where.push('t.assignee_id IS NULL');
    else if (value) where.push(`t.${field} = $${params.push(value)}`);
  }
  if (options.view === 'mine') {
    const param = `$${params.push(req.user.id)}`;
    where.push(`(t.requester_id = ${param} OR t.assignee_id = ${param})`);
  }
  if (options.view === 'queue') {
    if (req.user.role === 'requester') throw new HttpError(403, 'A fila é destinada às equipes de atendimento.');
    where.push(`t.assignee_id IS NULL AND t.status <> ALL($${params.push(terminal)}::status_type[])`);
  }
  if (options.q) {
    const phrase = `$${params.push(options.q)}`;
    where.push(`(strpos(lower(t.title), lower(${phrase})) > 0 OR strpos(lower(t.code), lower(${phrase})) > 0 OR strpos(lower(t.description), lower(${phrase})) > 0)`);
  }
  const condition = where.join(' AND ');
  const [items, count] = await Promise.all([
    pool.query(`${ticketSelect} WHERE ${condition} ORDER BY t.${sorts[options.sort]}, t.id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, options.size, (options.page - 1) * options.size]),
    pool.query(`SELECT count(*)::int AS total FROM tickets t WHERE ${condition}`, params)
  ]);
  res.json({ items: items.rows.map(({ description, ...item }) => ({ ...item, permissions: ticketActions(req.user, item) })), total: count.rows[0].total, page: options.page, size: options.size });
});

tickets.post('/', upload, async (req, res) => {
  const body = input.parse(req.body);
  const result = await transaction(db => createTicket(db, req.user, body, req.files));
  res.status(201).json(result);
});

tickets.patch('/bulk', async (req, res) => {
  const { ids, changes } = z.object({ ids: z.array(id).min(1).max(100), changes: patch }).parse(req.body);
  await transaction(async db => {
    for (const ticketId of [...new Set(ids)].sort((a, b) => a - b)) await changeTicket(db, req.user, ticketId, changes);
  });
  res.status(204).end();
});

tickets.param('id', (req, _res, next, value) => { req.ticketId = queryId.parse(value); next(); });

tickets.get('/:id', async (req, res) => {
  const ticket = await getTicket(pool, req.user, req.ticketId);
  const params = [ticket.id, ticket.permissions.work];
  const [comments, attachments, events, sla] = await Promise.all([
    pool.query(`SELECT c.id, c.body, c.internal, c.created_at, u.name AS author FROM comments c LEFT JOIN users u ON u.id = c.author_id
      WHERE c.ticket_id=$1 AND ($2 OR NOT c.internal) ORDER BY c.created_at, c.id`, params),
    pool.query('SELECT id, filename, size, created_at FROM attachments WHERE ticket_id = $1 ORDER BY id', [ticket.id]),
    pool.query(`SELECT a.id, a.action, a.changes, a.created_at, u.name AS actor FROM activity a LEFT JOIN users u ON u.id = a.actor_id
      WHERE a.ticket_id=$1 AND ($2 OR NOT a.internal) ORDER BY a.created_at DESC, a.id DESC`, params),
    pool.query(`SELECT cycle, phase, deadline, paused_at, breached_at, completed_at, cancelled_at FROM sla_targets WHERE ticket_id=$1 ORDER BY cycle DESC, phase`, [ticket.id])
  ]);
  res.json({ ticket, comments: comments.rows, attachments: attachments.rows, activity: events.rows, sla: sla.rows, server_time: new Date() });
});

tickets.patch('/:id', async (req, res) => {
  const changes = patch.parse(req.body);
  await transaction(db => changeTicket(db, req.user, req.ticketId, changes));
  res.status(204).end();
});

tickets.post('/:id/comments', async (req, res) => {
  const body = z.object({ body: z.string().trim().min(1).max(12000), internal: z.boolean().default(false) }).parse(req.body);
  await transaction(async db => addComment(db, await getTicket(db, req.user, req.ticketId, true), req.user, body));
  res.status(201).end();
});

tickets.post('/:id/attachments', upload, async (req, res) => {
  if (!req.files?.length) throw new HttpError(422, 'Selecione pelo menos um arquivo.');
  await transaction(async db => {
    const ticket = await getTicket(db, req.user, req.ticketId, true);
    if (!ticket.permissions.attach) throw new HttpError(403, 'Você não pode anexar arquivos neste chamado.');
    await addAttachments(db, ticket, req.user, req.files);
  });
  res.status(201).end();
});

tickets.get('/:id/attachments/:fileId', async (req, res) => {
  const fileId = queryId.parse(req.params.fileId);
  await getTicket(pool, req.user, req.ticketId);
  const { rows: [file] } = await pool.query('SELECT filename, content FROM attachments WHERE id=$1 AND ticket_id=$2', [fileId, req.ticketId]);
  if (!file) throw new HttpError(404, 'Anexo não encontrado.');
  res.attachment(file.filename).type('application/octet-stream').send(file.content);
});

tickets.post('/:id/escalate', async (req, res) => {
  await transaction(async db => {
    const ticket = await getTicket(db, req.user, req.ticketId, true);
    if (!ticket.permissions.work) throw new HttpError(403, 'Você não pode escalar este chamado.');
    if (ticket.priority !== 'critical' || terminal.includes(ticket.status)) throw new HttpError(409, 'Escale apenas chamados críticos ativos.');
    if (ticket.escalated_at) return;
    await db.query('UPDATE tickets SET escalated_at=now(), updated_at=now() WHERE id=$1', [ticket.id]);
    await activity(db, ticket.id, req.user.id, 'escalated', {}, true);
    await notify(db, ticket, 'escalated', `${ticket.code} foi escalado e requer atenção.`, { actor: req.user.id, team: true, requester: false });
  });
  res.status(204).end();
});
