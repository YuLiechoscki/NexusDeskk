import { Router } from 'express';
import { z } from 'zod';
import { DateTime } from 'luxon';
import { pool } from '../database/db.js';
import { allow, ticketScope } from '../domain.js';
import { getSettings, slaStateSql } from '../services/sla.js';
import { ticketSelect } from '../services/tickets.js';

export const analytics = Router();
const query = z.object({ days: z.enum(['7', '30', '90']).default('30').transform(Number), team_id: z.string().regex(/^\d{1,10}$/).transform(Number).pipe(z.number().int().positive().max(2147483647)).optional() });
const active = `status NOT IN ('resolved','closed','cancelled')`;
const summary = `count(*)::int AS total,
  (count(*) FILTER (WHERE status IN ('open','triage')))::int AS open,
  (count(*) FILTER (WHERE status='in_progress'))::int AS in_progress,
  (count(*) FILTER (WHERE status IN ('waiting_requester','waiting_third_party')))::int AS pending,
  (count(*) FILTER (WHERE status IN ('resolved','closed')))::int AS resolved,
  (count(*) FILTER (WHERE priority='critical' AND ${active}))::int AS critical,
  (count(*) FILTER (WHERE sla_state='warning' AND ${active}))::int AS warning,
  (count(*) FILTER (WHERE sla_state='breached'))::int AS breached,
  round(avg(extract(epoch FROM (first_response_at-created_at))/60))::int AS avg_response,
  round(avg(extract(epoch FROM (resolved_at-created_at))/60))::int AS avg_resolution`;

async function data(req, report = false) {
  const { days, team_id } = query.parse(req.query);
  const { timezone } = await getSettings(pool);
  const local = DateTime.now().setZone(timezone);
  const start = local.startOf('day').minus({ days: days - 1 });
  const params = [];
  let scope = ticketScope(req.user, params);
  if (team_id) scope += ` AND t.team_id = $${params.push(team_id)}`;
  const recentStart = `$${params.length + 1}`;
  const previousStart = `$${params.length + 2}`;
  const args = [...params, start.toJSDate(), start.minus({ days }).toJSDate()];
  const cte = `WITH scoped AS (SELECT t.*, (${slaStateSql('t')}) AS sla_state FROM tickets t WHERE ${scope} AND created_at >= ${previousStart}),
    current_period AS (SELECT * FROM scoped WHERE created_at >= ${recentStart})`;
  const results = await Promise.all([
    pool.query(`${cte} SELECT ${summary} FROM current_period UNION ALL SELECT ${summary} FROM scoped WHERE created_at < ${recentStart}`, args),
    pool.query(`${cte} SELECT priority AS key, count(*)::int AS value FROM current_period GROUP BY priority ORDER BY priority`, args),
    pool.query(`${cte} SELECT status AS key, count(*)::int AS value FROM current_period GROUP BY status ORDER BY status`, args),
    pool.query(`SELECT to_char(x.event_at AT TIME ZONE $${params.length + 2}, 'YYYY-MM-DD') AS day,
      (count(*) FILTER (WHERE x.kind='created'))::int AS created, (count(*) FILTER (WHERE x.kind='resolved'))::int AS resolved
      FROM tickets t CROSS JOIN LATERAL (VALUES (t.created_at, 'created'), (t.resolved_at, 'resolved')) x(event_at,kind)
      WHERE ${scope} AND (t.created_at >= ${recentStart} OR t.resolved_at >= ${recentStart})
      AND x.event_at >= ${recentStart} GROUP BY day ORDER BY day`, [...params, start.toJSDate(), timezone]),
    pool.query(`${cte} SELECT u.id, u.name, count(*)::int AS total,
      (count(*) FILTER (WHERE t.status IN ('resolved','closed')))::int AS resolved,
      (count(*) FILTER (WHERE t.${active}))::int AS active
      FROM current_period t JOIN users u ON u.id=t.assignee_id GROUP BY u.id ORDER BY resolved DESC, total DESC, u.name`, args),
    pool.query(`${cte} SELECT (count(*) FILTER (WHERE s.completed_at IS NOT NULL AND s.breached_at IS NULL))::int AS met,
      (count(*) FILTER (WHERE s.breached_at IS NOT NULL OR s.completed_at IS NULL AND s.cancelled_at IS NULL AND s.paused_at IS NULL AND s.deadline <= now()))::int AS breached
      FROM current_period t JOIN sla_targets s ON s.ticket_id=t.id`, args),
    report ? pool.query(`${cte} SELECT COALESCE(tm.name,'Sem equipe') AS name, count(*)::int AS total FROM current_period t
      LEFT JOIN teams tm ON t.team_id=tm.id WHERE t.${active} GROUP BY tm.id ORDER BY total DESC, name`, args)
      : pool.query(`${ticketSelect} WHERE ${scope} AND t.created_at >= ${recentStart} ORDER BY t.created_at DESC,t.id DESC LIMIT 6`, [...params, start.toJSDate()]),
    report ? pool.query(`${cte} SELECT to_char(created_at AT TIME ZONE $${args.length + 1}, 'YYYY-MM') AS month, count(*)::int AS total
      FROM current_period GROUP BY month ORDER BY month`, [...args, timezone]) : Promise.resolve({ rows: [] })
  ]);
  const [indicators, priorities, statuses, daily, agents, sla, additional, monthly] = results.map(result => result.rows);
  const dailyMap = new Map(daily.map(row => [row.day, row]));
  const series = Array.from({ length: days }, (_, index) => {
    const day = start.plus({ days: index }).toISODate();
    return dailyMap.get(day) ?? { day, created: 0, resolved: 0 };
  });
  const response = { days, from: start.toISODate(), to: local.toISODate(), indicators: indicators[0], previous: indicators[1],
    priorities, statuses, series, agents, sla: sla[0], monthly };
  if (report) response.backlog = additional;
  else response.recent = additional.map(({ description, ...ticket }) => ticket);
  return response;
}

analytics.get('/dashboard', async (req, res) => res.json(await data(req)));
analytics.get('/reports', allow('admin', 'manager', 'agent'), async (req, res) => res.json(await data(req, true)));

function csv(value) {
  let text = String(value ?? '');
  if (/^\s*[=+@-]|^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

analytics.get('/reports.csv', allow('admin', 'manager', 'agent'), async (req, res) => {
  const report = await data(req, true);
  const priorityLabels = { low: 'Baixa', medium: 'Média', high: 'Alta', critical: 'Crítica' };
  const { total, avg_response, avg_resolution } = report.indicators;
  const { met, breached } = report.sla;
  const rows = [['Grupo', 'Indicador', 'Valor', 'Detalhe'], ['Período', report.from, report.to], ['Atendimento', 'Chamados', total],
    ['Atendimento', 'Tempo médio de atendimento (min)', avg_response], ['Atendimento', 'Tempo médio de resolução (min)', avg_resolution],
    ['SLA', 'Cumpridos (%)', met + breached ? (100 * met / (met + breached)).toFixed(1) : ''], ['SLA', 'Violações', breached],
    ...report.priorities.map(row => ['Prioridade', priorityLabels[row.key], row.value]),
    ...report.agents.map(row => ['Produtividade', row.name, row.resolved, `${row.active} ativos`]),
    ...report.backlog.map(row => ['Backlog', row.name, row.total]), ...report.monthly.map(row => ['Evolução mensal', row.month, row.total])];
  res.attachment(`nexus-relatorio-${report.days}d.csv`).type('text/csv').send(`\uFEFF${rows.map(row => row.map(csv).join(';')).join('\r\n')}`);
});
