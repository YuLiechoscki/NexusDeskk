import { HttpError, terminal, ticketActions, ticketScope } from '../domain.js';
import { activity, notify } from './events.js';
import { initializeTargets, slaStateSql, updateTargets } from './sla.js';

export const ticketSelect = `SELECT t.*, r.name AS requester, a.name AS assignee, tm.name AS team, c.name AS category,
  (${slaStateSql('t')}) AS sla_state FROM tickets t JOIN users r ON r.id = t.requester_id
  LEFT JOIN users a ON a.id = t.assignee_id LEFT JOIN teams tm ON tm.id = t.team_id JOIN categories c ON c.id = t.category_id`;

export async function getTicket(db, user, id, lock = false) {
  const params = [id];
  const { rows: [ticket] } = await db.query(`${ticketSelect} WHERE t.id = $1 AND ${ticketScope(user, params)}${lock ? ' FOR UPDATE OF t' : ''}`, params);
  if (!ticket) throw new HttpError(404, 'Chamado não encontrado.');
  return { ...ticket, permissions: ticketActions(user, ticket) };
}

async function activeCategory(db, categoryId) {
  const { rowCount } = await db.query('SELECT 1 FROM categories WHERE id = $1 AND active FOR SHARE', [categoryId]);
  if (!rowCount) throw new HttpError(422, 'Selecione uma categoria ativa.');
}

async function validateAssignment(db, user, before, teamId, assigneeId) {
  if (teamId && teamId !== before.team_id) {
    const { rowCount } = await db.query('SELECT 1 FROM teams WHERE id = $1 AND active FOR SHARE', [teamId]);
    if (!rowCount) throw new HttpError(422, 'Selecione uma equipe ativa.');
  }
  if (!assigneeId) return;
  const { rowCount } = await db.query(`SELECT 1 FROM users u WHERE id = $1 AND active AND role IN ('admin', 'manager', 'agent')
    AND (u.role = 'admin' OR EXISTS (SELECT 1 FROM team_members WHERE team_id = $2 AND user_id = u.id)) FOR SHARE OF u`, [assigneeId, teamId]);
  if (!rowCount) throw new HttpError(422, 'Selecione um responsável ativo da equipe.');
  if (user.role === 'agent' && user.id !== assigneeId) throw new HttpError(403, 'Você só pode assumir o chamado para si.');
}

export async function createTicket(db, user, verdict, files) {
  await activeCategory(db, verdict.category_id);
  const { priority } = verdict;
  const { rows: [ticket] } = await db.query(`INSERT INTO tickets (title, description, requester_id, category_id, priority)
    VALUES ($1,$2,$3,$4,$5) RETURNING *`, [verdict.title, verdict.description, user.id, verdict.category_id, priority]);
  await initializeTargets(db, ticket, ticket.created_at);
  await activity(db, ticket.id, user.id, 'created', { title: ticket.title, priority });
  await addAttachments(db, ticket, user, files);
  await notify(db, ticket, 'created', `Novo chamado ${ticket.code}: ${ticket.title}`, { actor: user.id, team: true });
  return { id: ticket.id, code: ticket.code };
}

export async function changeTicket(db, user, id, patch) {
  const before = await getTicket(db, user, id, true);
  if (!before.permissions.work) throw new HttpError(403, 'Você não pode editar este chamado.');
  if (Object.hasOwn(patch, 'team_id') && !before.permissions.manage) throw new HttpError(403, 'A transferência exige um gestor da equipe.');
  const next = { ...before, ...patch };
  if (before.category_id !== next.category_id) await activeCategory(db, next.category_id);
  if (before.team_id !== next.team_id && !Object.hasOwn(patch, 'assignee_id')) next.assignee_id = null;
  if (before.team_id !== next.team_id || before.assignee_id !== next.assignee_id) {
    await validateAssignment(db, user, before, next.team_id, next.assignee_id);
  }
  const fields = ['title', 'description', 'status', 'priority', 'category_id', 'team_id', 'assignee_id'];
  const changes = Object.fromEntries(fields.filter(key => next[key] !== before[key]).map(key => [key, { before: before[key], after: next[key] }]));
  if (!Object.keys(changes).length) return;
  const now = new Date();
  const reopen = terminal.includes(before.status) && !terminal.includes(next.status);
  const resolution = ['resolved', 'closed'].includes(next.status) ? before.resolved_at ?? now : null;
  const { rows: [ticket] } = await db.query(`UPDATE tickets SET title=$2, description=$3, status=$4, priority=$5, category_id=$6,
    team_id=$7, assignee_id=$8, updated_at=$9, resolved_at=$10, sla_cycle=$11,
    escalated_at=CASE WHEN $12 THEN NULL ELSE escalated_at END WHERE id=$1 RETURNING *`,
  [id, ...fields.map(key => next[key]), now, resolution, before.sla_cycle + Number(reopen), reopen]);
  await updateTargets(db, before, ticket, now, user.id);
  await activity(db, id, user.id, 'updated', changes, false, now);
  if (changes.priority) await notify(db, ticket, 'priority', `A prioridade de ${ticket.code} foi alterada.`, { actor: user.id, team: true });
  if (changes.assignee_id || changes.team_id) await notify(db, ticket, 'assignment', `A atribuição de ${ticket.code} foi atualizada.`, { actor: user.id, team: true });
  if (changes.status && ['resolved', 'closed'].includes(ticket.status)) await notify(db, ticket, 'resolved', `${ticket.code} foi ${ticket.status === 'closed' ? 'fechado' : 'resolvido'}.`, { actor: user.id });
}

export async function addComment(db, ticket, user, { body, internal }) {
  if (!ticket.permissions.comment || (internal && !ticket.permissions.work)) throw new HttpError(403, 'Você não pode publicar esta mensagem.');
  if (terminal.includes(ticket.status)) throw new HttpError(409, 'Reabra o chamado para publicar uma mensagem.');
  const now = new Date();
  await db.query('INSERT INTO comments (ticket_id, author_id, body, internal, created_at) VALUES ($1,$2,$3,$4,$5)', [ticket.id, user.id, body, internal, now]);
  const response = ticket.permissions.work && user.id !== ticket.requester_id && !internal;
  await db.query('UPDATE tickets SET updated_at=$2, first_response_at=CASE WHEN $3 THEN COALESCE(first_response_at,$2) ELSE first_response_at END WHERE id=$1', [ticket.id, now, response]);
  if (response) await updateTargets(db, ticket, ticket, now, user.id, true);
  await activity(db, ticket.id, user.id, internal ? 'internal_comment' : 'comment', {}, internal, now);
  await notify(db, ticket, internal ? 'internal_comment' : 'comment', `Nova ${internal ? 'nota interna' : 'mensagem'} em ${ticket.code}.`, { actor: user.id, requester: !internal, team: true });
}

export async function addAttachments(db, ticket, user, files = []) {
  if (!files.length) return;
  const { rows: [result] } = await db.query('SELECT count(*)::int AS total FROM attachments WHERE ticket_id = $1', [ticket.id]);
  if (result.total + files.length > 20) throw new HttpError(422, 'O chamado pode ter até 20 anexos.');
  for (const file of files) {
    const decoded = Buffer.from(file.originalname, 'latin1').toString('utf8').replace(/[\u0000-\u001f\u007f\/\\]/g, '_');
    const filename = [...decoded].slice(0, 200).join('') || 'anexo';
    if (!file.size) throw new HttpError(422, 'O arquivo está vazio.');
    await db.query('INSERT INTO attachments (ticket_id, uploader_id, filename, size, content) VALUES ($1,$2,$3,$4,$5)',
      [ticket.id, user.id, filename, file.size, file.buffer]);
    await activity(db, ticket.id, user.id, 'attachment', { filename });
  }
}
