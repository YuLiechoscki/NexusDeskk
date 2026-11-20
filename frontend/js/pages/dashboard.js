import { api, download, queryString } from '../api.js';
import { activateDonut, activateTrend, bars, donut, metricCards, priorityBars, reportCards, slaSummary, trend } from '../charts.js';
import { icon } from '../icons.js';
import { actionLink, busy, button, empty, esc, lookupOptions, number, options, pageHead, panel, person, preference, priorityBadge, shortDate, statusBadge, table } from '../ui.js';

const periods = [[7, 'Últimos 7 dias'], [30, 'Últimos 30 dias'], [90, 'Últimos 90 dias']];
const picker = days => `<label class="period">${icon('calendar')}<span class="sr-only">Período</span><select name="days">${options(periods, days)}</select></label>`;
const headers = ['Chamado', 'Status', 'Prioridade', 'Responsável', 'Abertura'];

function recentTable(items, timezone) {
  const rows = items.map(ticket => `<tr><td><a class="ticket-link" href="#/ticket/${ticket.id}"><span class="ticket-code">${esc(ticket.code)}</span><span class="strong">${esc(ticket.title)}</span></a></td><td>${statusBadge(ticket.status)}</td><td>${priorityBadge(ticket.priority)}</td><td>${person(ticket.assignee)}</td><td class="muted nowrap">${shortDate(ticket.created_at, timezone)}</td></tr>`);
  return `<section class="panel recent-panel"><div class="panel-head"><div><h2 class="section-title">Chamados recentes</h2><p>Últimos chamados abertos no período</p></div>${actionLink('Ver todos', '', '#/tickets', '')}</div>${table(headers, rows, empty('Nenhum chamado recente', 'Ao criar um chamado, ele aparecerá aqui.'))}</section>`;
}

export async function dashboard(ctx, report = false) {
  const { root, request, session, route } = ctx;
  const endpoint = `/analytics/${report ? 'reports' : 'dashboard'}`;
  const days = [7, 30, 90].includes(Number(route.params.get('days'))) ? Number(route.params.get('days')) : Number(preference('period')) || 30;
  const team = report ? route.params.get('team_id') : null;
  const [data, directory] = await Promise.all([request(`${endpoint}${queryString({ days, team_id: team })}`), report ? request('/directory') : null]);
  const action = report ? `${picker(days)}<label><span class="sr-only">Equipe</span><select name="team_id">${options([['', 'Todas as equipes'], ...lookupOptions(directory.teams)], team)}</select></label>${button('Exportar CSV', 'download', '', 'data-export')}`
    : `${picker(days)}${actionLink('Criar chamado', 'plus', '#/create')}`;
  const agents = data.agents.slice(0, 5).map(agent => ({ label: agent.name, value: agent.resolved, title: `${agent.name}: ${agent.resolved} resolvidos e ${agent.active} ativos` }));
  const primary = `<div class="dashboard-charts">${trend(data.series)}${donut(data.statuses)}</div>`;
  const secondary = `<div class="dashboard-extra">${panel('Chamados por prioridade', priorityBars(data.priorities))}${panel('Desempenho dos atendentes', bars(agents), 'Chamados resolvidos por responsável')}${panel('Cumprimento do SLA', slaSummary(data.sla), 'Metas de resposta e resolução')}</div>`;
  const reportContent = report ? `<div class="split">${panel('Backlog por equipe', bars(data.backlog.map(row => ({ label: row.name, value: row.total }))))}${panel('Evolução mensal', bars(data.monthly.map(row => ({ label: row.month.split('-').reverse().join('/'), value: row.total }))))}</div>
    <section class="panel"><div class="panel-head"><h2 class="section-title">Produtividade por responsável</h2></div>${table(['Responsável', 'Total', 'Ativos', 'Resolvidos'], data.agents.map(row => `<tr><td>${person(row.name)}</td><td>${number(row.total)}</td><td>${number(row.active)}</td><td>${number(row.resolved)}</td></tr>`), empty('Sem atendimentos no período'))}</section>` : '';
  root.innerHTML = `${pageHead(report ? 'Relatórios' : 'Visão geral', report ? 'Analise volume, produtividade e cumprimento dos acordos de serviço.' : 'Acompanhe a operação da sua central de atendimento.', action)}<div class="stack">${report ? reportCards(data) : metricCards(data.indicators, data.previous)}${primary}${report ? secondary + reportContent : recentTable(data.recent, session.timezone) + secondary}</div>`;
  activateTrend(root, data.series);
  activateDonut(root);
  const navigate = () => {
    const days = root.querySelector('[name="days"]').value;
    const team = root.querySelector('[name="team_id"]')?.value;
    preference('period', days);
    location.hash = `#/${report ? 'reports' : 'dashboard'}${queryString({ days, team_id: team })}`;
  };
  root.querySelector('.page-actions').addEventListener('change', navigate);
  root.querySelector('[data-export]')?.addEventListener('click', event => busy(event.currentTarget, async () => {
    const blob = await api(`${endpoint}.csv${queryString({ days, team_id: team })}`, { binary: true });
    download(blob, `nexus-relatorio-${days}d.csv`);
  }));
}
