import { api, queryString } from '../api.js';
import { confirmAction, openDialog } from '../dialog.js';
import { icon } from '../icons.js';
import { actionLabels, actionLink, avatar, busy, button, empty, esc, fullDate, iconButton, lookupOptions, number, onSubmit,
  options, pageHead, pagination, panel, person, phaseLabels, priorityBadge, roleLabels, slaBadge, statusBadge, statusLabels, table, toast } from '../ui.js';

const errorSlot = '<p class="error-text" role="alert" hidden></p>';
const submit = (label = 'Salvar') => `<div class="form-actions">${button('Cancelar', '', '', 'data-close')}<button type="submit" class="button primary">${esc(label)}</button></div>`;
const activeBadge = active => `<span class="badge dot tone-${active ? 'green' : 'gray'}">${active ? 'Ativo' : 'Inativo'}</span>`;
const settingsLink = actionLink('Configurar calendário', 'calendar', '#/settings', '');

function entityEditor(ctx, kind, record) {
  const label = kind === 'teams' ? 'equipe' : 'categoria';
  const dialog = openDialog(`${record ? 'Editar' : 'Nova'} ${label}`, `<form class="form-stack"><label>Nome<input name="name" minlength="2" maxlength="100" value="${esc(record?.name)}" required></label>
    <label>Descrição<textarea name="description" maxlength="500">${esc(record?.description)}</textarea></label><label class="checkbox-label"><input type="checkbox" name="active" ${record?.active !== false ? 'checked' : ''}>Disponível para novos chamados</label>${errorSlot}${submit()}</form>`);
  onSubmit(dialog.querySelector('form'), async values => {
    await api(`/manage/${kind}${record ? `/${record.id}` : ''}`, { method: record ? 'PUT' : 'POST', body: { name: values.get('name'), description: values.get('description'), active: values.has('active') } });
    dialog.close(); toast(record ? 'Alterações salvas.' : 'Registro criado.'); ctx.refresh();
  });
}

export async function teams(ctx) {
  const { root, request, session } = ctx;
  const items = await request('/manage/teams');
  const admin = session.user.role === 'admin';
  root.innerHTML = `${pageHead('Equipes', 'Consulte a composição das equipes e os chamados em aberto.', admin ? button('Nova equipe', 'plus', 'primary', 'data-new') : '')}
    ${items.length ? `<div class="team-grid">${items.map(item => `<section class="panel team-card"><div class="team-head"><span class="group-icon tone-purple">${icon('users')}</span>${activeBadge(item.active)}</div><h2 class="section-title">${esc(item.name)}</h2><p class="muted small">${esc(item.description || 'Sem descrição')}</p>
      <div class="team-stats"><div><strong>${number(item.members.length)}</strong><span>Pessoas</span></div><div><strong>${number(item.backlog)}</strong><span>Backlog</span></div></div>
      <div class="team-members">${item.members.length ? item.members.map(member => `<span title="${esc(member.name)}">${avatar(member.name)}<span class="sr-only">${esc(member.name)}</span></span>`).join('') : '<span class="muted small">Sem membros</span>'}</div>
      <div class="team-foot">${actionLink('Ver chamados', '', `#/tickets?team_id=${item.id}`, 'compact')}${admin ? iconButton(`Editar ${item.name}`, 'edit', `data-edit="${item.id}"`) : ''}</div></section>`).join('')}</div>` : `<div class="panel">${empty('Nenhuma equipe disponível', 'As equipes às quais você tem acesso aparecem aqui.')}</div>`}`;
  root.querySelector('[data-new]')?.addEventListener('click', () => entityEditor(ctx, 'teams'));
  root.querySelectorAll('[data-edit]').forEach(control => control.addEventListener('click', () => entityEditor(ctx, 'teams', items.find(item => item.id === Number(control.dataset.edit)))));
}

export async function owners({ root, request }) {
  const items = await request('/manage/owners');
  const rows = items.map(item => `<tr><td>${person(item.name)}</td><td>${esc(roleLabels[item.role])}</td><td>${esc(item.teams.join(', ') || '—')}</td><td class="numeric">${number(item.active)}</td><td class="numeric">${number(item.resolved)}</td><td class="numeric">${number(item.critical)}</td><td><a class="text-link" href="#/tickets?assignee_id=${item.id}">Ver chamados</a></td></tr>`);
  root.innerHTML = `${pageHead('Responsáveis', 'Acompanhe a distribuição da carga de atendimento.')}<section class="panel">${table(['Nome', 'Papel', 'Equipes', 'Em aberto', 'Resolvidos', 'Críticos', ''], rows, empty('Nenhum responsável encontrado'))}</section>`;
}

export async function categories(ctx) {
  const { root, request } = ctx;
  const items = await request('/manage/categories');
  const rows = items.map(item => `<tr><td class="strong">${esc(item.name)}</td><td>${esc(item.description || '—')}</td><td class="numeric">${number(item.tickets)}</td><td>${activeBadge(item.active)}</td><td>${iconButton(`Editar ${item.name}`, 'edit', `data-edit="${item.id}"`)}</td></tr>`);
  root.innerHTML = `${pageHead('Categorias', 'Organize os tipos de solicitação disponíveis no formulário de chamados.', button('Nova categoria', 'plus', 'primary', 'data-new'))}<section class="panel">${table(['Categoria', 'Descrição', 'Chamados', 'Situação', ''], rows, empty('Nenhuma categoria cadastrada'))}</section>`;
  root.querySelector('[data-new]').addEventListener('click', () => entityEditor(ctx, 'categories'));
  root.querySelectorAll('[data-edit]').forEach(control => control.addEventListener('click', () => entityEditor(ctx, 'categories', items.find(item => item.id === Number(control.dataset.edit)))));
}

function userEditor(ctx, directory, record) {
  const choices = lookupOptions(directory.teams).concat(directory.teams.filter(team => !team.active && record?.team_ids.includes(team.id)).map(team => [team.id, team.name]));
  const selected = record?.team_ids ?? [];
  const dialog = openDialog(record ? 'Editar usuário' : 'Novo usuário', `<form class="form-stack"><label>Nome<input name="name" minlength="2" maxlength="100" value="${esc(record?.name)}" required></label>
    <label>E-mail<input type="email" name="email" maxlength="254" value="${esc(record?.email)}" required></label><div class="form-row"><label>Papel<select name="role">${options(Object.entries(roleLabels), record?.role ?? 'requester')}</select></label>
    <label>${record ? 'Nova senha (opcional)' : 'Senha inicial'}<input type="password" name="password" autocomplete="new-password" minlength="12" maxlength="128" ${record ? '' : 'required'}></label></div>
    <fieldset data-members><legend class="field-title">Equipes</legend><div class="check-row">${choices.map(([id, label]) => `<label><input type="checkbox" name="team_ids" value="${id}" ${selected.includes(id) ? 'checked' : ''}>${esc(label)}</label>`).join('') || '<span class="muted small">Nenhuma equipe cadastrada.</span>'}</div></fieldset>
    <label class="checkbox-label"><input type="checkbox" name="active" ${record?.active !== false ? 'checked' : ''}>Usuário ativo</label>${errorSlot}${submit()}</form>`);
  const form = dialog.querySelector('form');
  const updateTeams = () => { form.querySelector('[data-members]').hidden = form.elements.role.value === 'requester'; };
  form.elements.role.addEventListener('change', updateTeams); updateTeams();
  onSubmit(form, async values => {
    const { name, email, role } = Object.fromEntries(values);
    const body = { name, email, role, team_ids: values.getAll('team_ids').map(Number), active: values.has('active') };
    if (values.get('password')) body.password = values.get('password');
    await api(`/manage/users${record ? `/${record.id}` : ''}`, { method: record ? 'PUT' : 'POST', body });
    dialog.close(); toast('Usuário salvo.'); ctx.refresh();
  });
}

export async function users(ctx) {
  const { root, request } = ctx;
  const [items, directory] = await Promise.all([request('/manage/users'), request('/directory')]);
  const rows = items.map(item => `<tr><td>${person(item.name)}</td><td>${esc(item.email)}</td><td><span class="badge tone-purple">${esc(roleLabels[item.role])}</span></td>
    <td>${esc(item.team_ids.map(id => directory.teams.find(team => team.id === id)?.name).filter(Boolean).join(', ') || '—')}</td><td>${activeBadge(item.active)}</td><td>${iconButton(`Editar ${item.name}`, 'edit', `data-edit="${item.id}"`)}</td></tr>`);
  root.innerHTML = `${pageHead('Usuários', 'Gerencie contas, permissões e vínculos com equipes.', button('Novo usuário', 'plus', 'primary', 'data-new'))}<section class="panel">${table(['Nome', 'E-mail', 'Papel', 'Equipes', 'Situação', ''], rows, empty('Nenhum usuário cadastrado'))}</section>`;
  root.querySelector('[data-new]').addEventListener('click', () => userEditor(ctx, directory));
  root.querySelectorAll('[data-edit]').forEach(control => control.addEventListener('click', () => userEditor(ctx, directory, items.find(item => item.id === Number(control.dataset.edit)))));
}

function policyEditor(ctx, policy) {
  const dialog = openDialog('Editar política de SLA', `<form class="form-stack">${priorityBadge(policy.priority)}<label>Primeira resposta (minutos úteis)<input name="response_minutes" min="1" max="43200" type="number" value="${policy.response_minutes}" required></label>
    <label>Resolução (minutos úteis)<input name="resolution_minutes" min="1" max="43200" type="number" value="${policy.resolution_minutes}" required></label>${errorSlot}${submit()}</form>`);
  onSubmit(dialog.querySelector('form'), async values => {
    const body = Object.fromEntries([...values].map(([key, value]) => [key, Number(value)]));
    if (body.resolution_minutes < body.response_minutes) throw new Error('O prazo de resolução deve ser igual ou maior que o de primeira resposta.');
    await api(`/manage/sla/policies/${policy.priority}`, { method: 'PUT', body });
    dialog.close(); toast('Política de SLA atualizada.'); ctx.refresh();
  });
}

function holidayEditor(ctx) {
  const dialog = openDialog('Cadastrar feriado', `<form class="form-stack"><label>Data<input type="date" name="day" required></label><label>Nome<input name="name" minlength="2" maxlength="100" required></label>${errorSlot}${submit('Cadastrar')}</form>`);
  onSubmit(dialog.querySelector('form'), async values => {
    await api('/manage/sla/holidays', { method: 'POST', body: Object.fromEntries(values) });
    dialog.close(); toast('Feriado cadastrado.'); ctx.refresh();
  });
}

const ticketLink = ticket => `<a class="ticket-link" href="#/ticket/${ticket.id}"><span class="ticket-code">${esc(ticket.code)}</span><span class="strong">${esc(ticket.title)}</span></a>`;
const businessTime = minutes => [minutes >= 60 && `${Math.floor(minutes / 60)}h`, minutes % 60 && `${minutes % 60}min`].filter(Boolean).join(' ');

export async function sla(ctx) {
  const { root, request, session } = ctx;
  const data = await request('/manage/sla');
  const admin = session.user.role === 'admin';
  const policyRows = data.policies.map(policy => `<tr><td>${priorityBadge(policy.priority)}</td><td>${businessTime(policy.response_minutes)}</td><td>${businessTime(policy.resolution_minutes)}</td>${admin ? `<td>${iconButton('Editar política', 'edit', `data-policy="${policy.priority}"`)}</td>` : ''}</tr>`);
  const holidayRows = data.holidays.map(holiday => `<tr><td>${esc(holiday.day.split('-').reverse().join('/'))}</td><td>${esc(holiday.name)}</td>${admin ? `<td>${iconButton(`Remover ${holiday.name}`, 'trash', `data-remove="${esc(holiday.day)}"`)}</td>` : ''}</tr>`);
  const alerts = data.attention.map(ticket => `<tr><td>${ticketLink(ticket)}</td><td>${priorityBadge(ticket.priority)}</td><td>${statusBadge(ticket.status)}</td><td>${slaBadge(ticket.sla_state)}</td><td>${ticket.escalated_at ? '<span class="badge tone-red">Escalado</span>' : '—'}</td></tr>`);
  const history = data.history.map(item => `<tr><td>${ticketLink(item)}</td><td>${esc(phaseLabels[item.phase])} · ${item.cycle}</td><td>${fullDate(item.deadline, session.timezone)}</td><td>${fullDate(item.breached_at ?? item.completed_at, session.timezone)}</td><td>${slaBadge(item.breached_at ? 'breached' : 'met')}</td></tr>`);
  root.innerHTML = `${pageHead('Controle de SLA', 'Acompanhe os prazos de primeira resposta e resolução.', admin ? settingsLink : '')}<div class="stack"><div class="split">
    <section class="panel"><div class="panel-head"><div><h2 class="section-title">Políticas por prioridade</h2><p>Metas em tempo útil</p></div></div>${table(['Prioridade', 'Primeira resposta', 'Resolução', ...(admin ? [''] : [])], policyRows)}</section>
    <section class="panel"><div class="panel-head"><div><h2 class="section-title">Feriados</h2><p>${esc(data.settings.timezone)} · ${esc(data.settings.business_start)}–${esc(data.settings.business_end)}</p></div>${admin ? button('Cadastrar', 'plus', 'compact', 'data-holiday') : ''}</div>
    ${table(['Data', 'Feriado', ...(admin ? [''] : [])], holidayRows, '<p class="muted small panel-body">Nenhum feriado cadastrado.</p>')}</section></div>
    <section class="panel"><div class="panel-head"><h2 class="section-title">Chamados que exigem atenção</h2></div>${table(['Chamado', 'Prioridade', 'Status', 'SLA', 'Escalonamento'], alerts, empty('Nenhum SLA requer atenção'))}</section>
    <section class="panel"><div class="panel-head"><h2 class="section-title">Histórico de cumprimento</h2></div>${table(['Chamado', 'Meta e ciclo', 'Prazo', 'Ocorrência', 'Resultado'], history, empty('Nenhuma meta concluída'))}</section></div>`;
  root.querySelectorAll('[data-policy]').forEach(control => control.addEventListener('click', () => policyEditor(ctx, data.policies.find(policy => policy.priority === control.dataset.policy))));
  root.querySelector('[data-holiday]')?.addEventListener('click', () => holidayEditor(ctx));
  root.querySelectorAll('[data-remove]').forEach(control => control.addEventListener('click', async () => {
    const item = data.holidays.find(holiday => holiday.day === control.dataset.remove);
    if (!await confirmAction('Remover feriado', `Remover ${item.name} do calendário?`, 'Remover')) return;
    await busy(control, async () => { await api(`/manage/sla/holidays/${item.day}`, { method: 'DELETE' }); toast('Feriado removido.'); ctx.refresh(); });
  }));
}

export async function settings(ctx) {
  const { root, request, session } = ctx;
  const value = await request('/manage/settings');
  const days = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];
  const pauseable = ['triage', 'in_progress', 'waiting_requester', 'waiting_third_party'];
  root.innerHTML = `${pageHead('Configurações', 'Defina o nome do workspace e o expediente usado pelo SLA.')}${panel('Workspace e calendário', `<form class="form-stack settings-form">
    <div class="form-row"><label>Nome do workspace<input name="workspace_name" value="${esc(value.workspace_name)}" required minlength="2" maxlength="100"></label><label>Fuso horário<input name="timezone" list="timezones" required value="${esc(value.timezone)}"><datalist id="timezones">${['America/Sao_Paulo','America/Manaus','America/Recife','America/Fortaleza','America/Rio_Branco','UTC'].map(zone => `<option value="${zone}">`).join('')}</datalist></label></div>
    <fieldset><legend class="field-title">Dias úteis</legend><div class="check-row">${days.map((day, index) => `<label><input name="business_days" type="checkbox" value="${index + 1}" ${value.business_days.includes(index + 1) ? 'checked' : ''}>${day}</label>`).join('')}</div></fieldset>
    <div class="form-row"><label>Início do expediente<input type="time" name="business_start" value="${esc(value.business_start)}" required></label><label>Fim do expediente<input type="time" name="business_end" value="${esc(value.business_end)}" required></label></div>
    <fieldset><legend class="field-title">Status que pausam o SLA</legend><div class="check-row">${pauseable.map(key => `<label><input type="checkbox" name="pause_statuses" value="${key}" ${value.pause_statuses.includes(key) ? 'checked' : ''}>${statusLabels[key]}</label>`).join('')}</div></fieldset>
    <label>Antecedência do alerta (minutos corridos)<input type="number" name="warning_minutes" min="1" max="10080" value="${value.warning_minutes}" required></label>
    <p class="muted small">O calendário é registrado a cada novo ciclo de SLA. Cadastre os feriados em Controle de SLA.</p>${errorSlot}<div class="form-actions"><button class="button primary" type="submit">Salvar configurações</button></div></form>`)}`;
  onSubmit(root.querySelector('form'), async values => {
    const { workspace_name, timezone, business_start, business_end, warning_minutes } = Object.fromEntries(values);
    const business_days = values.getAll('business_days').map(Number);
    if (!business_days.length || business_end <= business_start) throw new Error('Selecione pelo menos um dia e um expediente com início anterior ao término.');
    await api('/manage/settings', { method: 'PUT', body: { workspace_name, timezone, business_start, business_end, warning_minutes: Number(warning_minutes), business_days, pause_statuses: values.getAll('pause_statuses') } });
    Object.assign(session, await api('/auth/me'));
    toast('Configurações salvas.'); ctx.refresh();
  });
}

export async function audit(ctx) {
  const { root, request, route, session } = ctx;
  const page = Math.max(1, Number(route.params.get('page')) || 1);
  const data = await request(`/manage/audit${queryString({ page })}`);
  const rows = data.items.map(item => `<tr><td class="nowrap">${fullDate(item.created_at, session.timezone)}</td><td>${item.actor ? person(item.actor) : '<span class="muted">Sistema</span>'}</td>
    <td>${esc(actionLabels[item.action] ?? item.action)}</td><td>${item.ticket_id ? `<a class="text-link" href="#/ticket/${item.ticket_id}">${esc(item.code)}</a>` : '—'}</td><td>${button('Detalhes', '', 'compact', `data-audit="${item.id}"`)}</td></tr>`);
  root.innerHTML = `${pageHead('Auditoria', 'Consulte alterações em chamados, contas, políticas e calendário.')}<section class="panel">${table(['Data e hora', 'Responsável', 'Ação', 'Chamado', ''], rows, empty('Nenhum evento registrado'))}${pagination(data.total, page, 25)}</section>`;
  root.querySelectorAll('[data-audit]').forEach(control => control.addEventListener('click', () => {
    const item = data.items.find(item => item.id === Number(control.dataset.audit));
    openDialog(actionLabels[item.action] ?? item.action, `<pre class="audit-json pre-wrap">${esc(JSON.stringify(item.changes, null, 2))}</pre>`);
  }));
  root.querySelectorAll('[data-page]').forEach(control => control.addEventListener('click', () => { location.hash = `#/audit?page=${control.dataset.page}`; }));
}
