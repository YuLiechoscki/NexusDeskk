import { terminal } from '../domain.js';
import { transaction } from '../database/db.js';
import { addBusinessMinutes, businessMinutesBetween } from './calendar.js';
import { activity, notify } from './events.js';

const phases = ['response', 'resolution'];
const phaseNames = { response: 'primeira resposta', resolution: 'resolução' };

export async function getSettings(db) {
  const { rows: [settings] } = await db.query(`SELECT workspace_name, timezone, business_days, business_start, business_end,
    pause_statuses::text[] AS pause_statuses, warning_minutes FROM settings`);
  return settings;
}

export async function initializeTargets(db, ticket, at) {
  const settings = await getSettings(db);
  const { rows: holidays } = await db.query('SELECT day::text FROM holidays');
  const { rows: [policy] } = await db.query('SELECT * FROM sla_policies WHERE priority = $1', [ticket.priority]);
  const { timezone, business_days, business_start, business_end } = settings;
  const calendar = { timezone, business_days, business_start, business_end, holidays: holidays.map(holiday => holiday.day) };
  for (const phase of phases) {
    const minutes = policy[`${phase}_minutes`];
    const deadline = addBusinessMinutes(at, minutes, calendar);
    await db.query(`INSERT INTO sla_targets (ticket_id, cycle, phase, budget_minutes, remaining_minutes, calendar, running_since, deadline)
      VALUES ($1, $2, $3, $4::integer, $4::integer, $5, $6, $7)`, [ticket.id, ticket.sla_cycle, phase, minutes, calendar, at, deadline]);
  }
}

function isActive(target) {
  return !target.completed_at && !target.cancelled_at;
}

async function recordBreach(db, ticket, target, at) {
  if (target.breached_at || target.paused_at || !isActive(target) || at < target.deadline) return;
  target.breached_at = target.deadline;
  await db.query('UPDATE sla_targets SET breached_at = $4 WHERE ticket_id = $1 AND cycle = $2 AND phase = $3',
    [ticket.id, target.cycle, target.phase, target.breached_at]);
  await activity(db, ticket.id, null, 'sla_breached', { phase: target.phase, cycle: target.cycle }, false, target.breached_at);
  await notify(db, ticket, 'sla_breached', `${ticket.code} venceu o prazo de ${phaseNames[target.phase]}.`, { team: true, requester: false });
}

export async function updateTargets(db, before, ticket, at, actor, firstReply = false) {
  const settings = await getSettings(db);
  if (ticket.sla_cycle !== before.sla_cycle) await initializeTargets(db, ticket, at);
  const { rows } = await db.query('SELECT * FROM sla_targets WHERE ticket_id = $1 AND cycle = $2 FOR UPDATE', [ticket.id, ticket.sla_cycle]);
  const priorityChanged = before.priority !== ticket.priority && before.sla_cycle === ticket.sla_cycle;
  let policy;
  if (priorityChanged) ({ rows: [policy] } = await db.query('SELECT * FROM sla_policies WHERE priority = $1', [ticket.priority]));
  const pause = settings.pause_statuses.includes(ticket.status);
  const closed = terminal.includes(ticket.status);

  for (const target of rows.filter(isActive)) {
    await recordBreach(db, ticket, target, at);
    const complete = (firstReply && target.phase === 'response') ||
      (closed && ticket.status !== 'cancelled' && target.phase === 'resolution');
    if (complete || closed) {
      await db.query(`UPDATE sla_targets SET completed_at = $4, cancelled_at = $5, paused_at = NULL, running_since = NULL
        WHERE ticket_id = $1 AND cycle = $2 AND phase = $3`, [ticket.id, target.cycle, target.phase, complete ? at : null, complete ? null : at]);
      continue;
    }
    if (!priorityChanged && pause === Boolean(target.paused_at)) continue;

    const newBudget = policy?.[`${target.phase}_minutes`] ?? target.budget_minutes;
    const used = target.running_since ? businessMinutesBetween(target.running_since, at, target.calendar) : 0;
    const remaining = target.remaining_minutes - used + newBudget - target.budget_minutes;
    const deadline = target.breached_at ? target.deadline : addBusinessMinutes(at, remaining, target.calendar);
    const pausedAt = pause && !target.breached_at ? target.paused_at ?? at : null;
    await db.query(`UPDATE sla_targets SET budget_minutes = $4, remaining_minutes = $5, running_since = $6, deadline = $7,
      paused_at = $8, warned_at = CASE WHEN $9 THEN NULL ELSE warned_at END WHERE ticket_id = $1 AND cycle = $2 AND phase = $3`,
    [ticket.id, target.cycle, target.phase, newBudget, remaining, pausedAt ? null : at, deadline, pausedAt, priorityChanged && !target.breached_at]);
    if (Boolean(pausedAt) !== Boolean(target.paused_at)) {
      await activity(db, ticket.id, actor, pausedAt ? 'sla_paused' : 'sla_resumed', { phase: target.phase, cycle: target.cycle }, false, at);
    }
    await recordBreach(db, ticket, { ...target, deadline, paused_at: pausedAt }, at);
  }
}

export async function scanSla() {
  await transaction(async db => {
    const { rows: [lock] } = await db.query('SELECT pg_try_advisory_xact_lock(514033) AS acquired');
    if (!lock.acquired) return;
    const { warning_minutes: warning } = await getSettings(db);
    const now = new Date();
    const { rows: tickets } = await db.query(`SELECT t.* FROM tickets t WHERE EXISTS (
      SELECT 1 FROM sla_targets s WHERE s.ticket_id = t.id AND s.cycle = t.sla_cycle
      AND s.completed_at IS NULL AND s.cancelled_at IS NULL AND s.breached_at IS NULL AND s.paused_at IS NULL
      AND (s.deadline <= $1 OR s.warned_at IS NULL AND s.deadline <= $1::timestamptz + $2::integer * interval '1 minute'))
      ORDER BY t.id LIMIT 200 FOR UPDATE OF t SKIP LOCKED`, [now, warning]);
    for (const ticket of tickets) {
      const { rows } = await db.query(`SELECT * FROM sla_targets WHERE ticket_id = $1 AND cycle = $2 AND deadline <= $3::timestamptz + $4::integer * interval '1 minute'
        AND completed_at IS NULL AND cancelled_at IS NULL AND paused_at IS NULL AND breached_at IS NULL`, [ticket.id, ticket.sla_cycle, now, warning]);
      for (const target of rows) {
        if (target.deadline <= now) {
          await recordBreach(db, ticket, target, now);
        } else if (!target.warned_at) {
          await db.query('UPDATE sla_targets SET warned_at = $4 WHERE ticket_id = $1 AND cycle = $2 AND phase = $3', [ticket.id, target.cycle, target.phase, now]);
          await notify(db, ticket, 'sla_warning', `${ticket.code} está próximo do prazo de ${phaseNames[target.phase]}.`, { team: true, requester: false });
        }
      }
    }
  });
}

export const slaStateSql = alias => `SELECT CASE
  WHEN bool_or(breached_at IS NOT NULL OR completed_at IS NULL AND cancelled_at IS NULL AND paused_at IS NULL AND deadline <= now()) THEN 'breached'
  WHEN bool_or(completed_at IS NULL AND cancelled_at IS NULL AND paused_at IS NULL AND deadline <= now() + (SELECT warning_minutes FROM settings) * interval '1 minute') THEN 'warning'
  WHEN bool_or(completed_at IS NULL AND cancelled_at IS NULL AND paused_at IS NULL) THEN 'on_track'
  WHEN bool_or(completed_at IS NULL AND cancelled_at IS NULL AND paused_at IS NOT NULL) THEN 'paused'
  WHEN bool_or(completed_at IS NOT NULL) THEN 'met' ELSE 'cancelled' END
  FROM sla_targets WHERE ticket_id = ${alias}.id AND cycle = ${alias}.sla_cycle`;
