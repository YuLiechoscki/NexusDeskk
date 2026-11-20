import { api, download } from '../api.js';
import { confirmAction, openDialog } from '../dialog.js';
import { icon } from '../icons.js';
import { actionLabels, avatar, busy, button, duration, empty, esc, fieldLabels, fullDate, lookupOptions, onSubmit, options,
  panel, phaseLabels, priorityBadge, priorityLabels, slaBadge, statusBadge, statusLabels, terminal, toast } from '../ui.js';

const nullableId = value => value ? Number(value) : null;
const errorSlot = '<p class="error-text" role="alert" hidden></p>';

function valueLabel(key, value, directory) {
  if (value === null || value === undefined || value === '') return '—';
  if (key === 'status') return statusLabels[value] ?? value;
  if (key === 'priority') return priorityLabels[value] ?? value;
  const set = { category_id: 'categories', team_id: 'teams', assignee_id: 'people' }[key];
  return set ? directory[set].find(item => item.id === value)?.name ?? `#${value}` : value;
}

function timeline(items, directory, timezone) {
  return `<ul class="timeline">${items.map(item => `<li><div class="timeline-icon">${icon(item.action.startsWith('sla') ? 'timer' : 'history')}</div><div>
    <div><strong>${esc(item.actor ?? 'Sistema')}</strong> · ${esc(actionLabels[item.action] ?? item.action)}</div>
    ${item.action === 'updated' ? `<ul class="timeline-changes">${Object.entries(item.changes).map(([key, change]) => `<li><span class="strong">${esc(fieldLabels[key] ?? key)}</span><span class="pre-wrap">${esc(valueLabel(key, change.before, directory))} → ${esc(valueLabel(key, change.after, directory))}</span></li>`).join('')}</ul>` : ''}
    ${item.changes.phase ? `<p class="muted small">${esc(phaseLabels[item.changes.phase])} · Ciclo ${item.changes.cycle}</p>` : ''}
    ${item.changes.filename ? `<p class="muted small">${esc(item.changes.filename)}</p>` : ''}
    <time class="muted small" datetime="${esc(item.created_at)}">${fullDate(item.created_at, timezone)}</time></div></li>`).join('')}</ul>`;
}

function conversation(comments, ticket, timezone) {
  const messages = comments.map(message => `<article class="message ${message.internal ? 'internal' : ''}">${avatar(message.author ?? 'Sistema')}<div><header><strong>${esc(message.author ?? 'Sistema')}</strong>${message.internal ? '<span class="badge tone-amber">Nota interna</span>' : ''}<time class="muted small" datetime="${esc(message.created_at)}">${fullDate(message.created_at, timezone)}</time></header><p class="pre-wrap">${esc(message.body)}</p></div></article>`).join('');
  const form = ticket.permissions.comment && !terminal.includes(ticket.status) ? `<form class="form-stack reply-form" id="reply-form"><label>Resposta<textarea name="body" maxlength="12000" placeholder="Escreva uma mensagem…" required></textarea></label>${errorSlot}
    <div class="reply-actions">${ticket.permissions.work ? '<label class="checkbox-label"><input type="checkbox" name="internal">Nota interna</label>' : '<span></span>'}<button type="submit" class="button primary">${icon('message')}Enviar mensagem</button></div></form>` : '';
  return `${messages ? `<div class="thread">${messages}</div>` : '<p class="muted small thread-empty">Nenhuma mensagem neste chamado.</p>'}${form}`;
}

function attachments(items, ticket) {
  const files = items.length ? `<ul class="file-list">${items.map(item => `<li>${icon('paperclip')}<span class="truncate" title="${esc(item.filename)}">${esc(item.filename)}</span><span class="muted small">${Math.max(1, Math.round(item.size / 1024))} KB</span>${button('Baixar', 'download', 'compact ghost', `data-file="${item.id}"`)}</li>`).join('')}</ul>` : '<p class="muted small">Nenhum anexo.</p>';
  return `${files}${ticket.permissions.attach ? `${button('Adicionar anexos', 'plus', 'compact', 'data-upload')}` : ''}`;
}

function ticketFields(ticket, directory, timezone) {
  const general = `<dl class="detail-meta"><div><dt>Solicitante</dt><dd>${esc(ticket.requester)}</dd></div><div><dt>Abertura</dt><dd>${fullDate(ticket.created_at, timezone)}</dd></div>
    ${ticket.resolved_at ? `<div><dt>Resolução</dt><dd>${fullDate(ticket.resolved_at, timezone)}</dd></div>` : ''}</dl>`;
  if (!ticket.permissions.work) return `<dl class="detail-meta"><div><dt>Prioridade</dt><dd>${priorityBadge(ticket.priority)}</dd></div><div><dt>Status</dt><dd>${statusBadge(ticket.status)}</dd></div><div><dt>Responsável</dt><dd>${esc(ticket.assignee ?? 'Não atribuído')}</dd></div><div><dt>Equipe</dt><dd>${esc(ticket.team ?? 'Sem equipe')}</dd></div><div><dt>Categoria</dt><dd>${esc(ticket.category)}</dd></div></dl>${general}`;
  return `<form class="form-stack" id="properties-form"><label>Status<select name="status">${options(Object.entries(statusLabels), ticket.status)}</select></label>
    <label>Prioridade<select name="priority">${options(Object.entries(priorityLabels), ticket.priority)}</select></label>
    ${ticket.permissions.manage ? `<label>Equipe<select name="team_id">${options([['', 'Sem equipe'], ...lookupOptions(directory.teams, ticket.team_id)], ticket.team_id)}</select></label>` : `<div class="small"><span class="strong">Equipe</span><p class="muted">${esc(ticket.team ?? 'Sem equipe')}</p></div>`}
    <label>Responsável<select name="assignee_id"></select></label><label>Categoria<select name="category_id">${options(lookupOptions(directory.categories, ticket.category_id), ticket.category_id)}</select></label>
    ${errorSlot}<button type="submit" class="button">Salvar propriedades</button></form>${general}`;
}

function clocks(targets, ticket, timezone) {
  const current = targets.filter(target => target.cycle === ticket.sla_cycle);
  const previous = targets.filter(target => target.cycle !== ticket.sla_cycle);
  const status = target => target.breached_at ? 'breached' : target.paused_at ? 'paused' : target.cancelled_at ? 'cancelled' : target.completed_at ? 'met' : 'on_track';
  return `<div class="clock-status">${slaBadge(ticket.sla_state)}</div><ul class="clock-list">${current.map((target, index) => `<li><strong>${phaseLabels[target.phase]}</strong>
    <time class="muted small" datetime="${esc(target.deadline)}">${target.paused_at ? 'Prazo suspenso' : fullDate(target.deadline, timezone)}</time><span data-clock="${index}" class="small numeric"></span></li>`).join('')}</ul>
    ${previous.length ? `<details class="old-clocks"><summary>Ciclos anteriores</summary><ul class="clock-list">${previous.map(target => `<li><strong>Ciclo ${target.cycle} · ${phaseLabels[target.phase]}</strong>${slaBadge(status(target))}</li>`).join('')}</ul></details>` : ''}`;
}

export async function detail(ctx) {
  const { root, request, session, route, signal } = ctx;
  const [data, directory] = await Promise.all([request(`/tickets/${route.id}`), request('/directory')]);
  const { ticket, comments, activity, attachments: files, sla, server_time } = data;
  const { timezone, user } = session;
  const active = !terminal.includes(ticket.status);
  const canEscalate = ticket.permissions.work && active && ticket.priority === 'critical' && !ticket.escalated_at;
  root.innerHTML = `<div class="detail-back"><a class="inline text-link small" href="#/tickets">${icon('arrowLeft')}Chamados</a><span class="ticket-code">${esc(ticket.code)}</span></div>
    <div class="page-head detail-head"><div><h1>${esc(ticket.title)}</h1><div class="inline detail-badges">${statusBadge(ticket.status)}${priorityBadge(ticket.priority)}${ticket.escalated_at ? '<span class="badge tone-red">Escalado</span>' : ''}</div></div><div class="page-actions">
    ${canEscalate ? button('Escalar chamado', 'flag', '', 'data-escalate') : ''}${ticket.permissions.work ? button('Editar chamado', 'edit', '', 'data-edit') : ''}</div></div>
    <div class="detail-grid"><div class="stack">${panel('Descrição', `<p class="description pre-wrap">${esc(ticket.description)}</p>`)}
    ${panel('Anexos', `<div class="attachments">${attachments(files, ticket)}</div>`)}${panel('Conversa', conversation(comments, ticket, timezone))}
    ${panel('Histórico de atividades', activity.length ? timeline(activity, directory, timezone) : empty('Nenhuma atividade registrada'))}</div>
    <aside class="stack" aria-label="Informações do chamado">${panel('Propriedades', ticketFields(ticket, directory, timezone))}${panel('Acordo de serviço', clocks(sla, ticket, timezone))}</aside></div>`;

  const update = async (changes, message) => {
    await api(`/tickets/${ticket.id}`, { method: 'PATCH', body: changes });
    toast(message);
    ctx.refresh();
  };

  const props = root.querySelector('#properties-form');
  if (props) {
    const userSelect = props.elements.assignee_id;
    const teamSelect = props.elements.team_id;
    const pickOwners = selected => {
      const team = teamSelect ? nullableId(teamSelect.value) : ticket.team_id;
      const people = directory.people.filter(owner => (owner.role === 'admin' || owner.team_ids.includes(team) || owner.id === selected) && (ticket.permissions.manage || owner.id === user.id || owner.id === selected));
      const choices = people.map(owner => [owner.id, owner.name]);
      if (selected && !choices.some(([id]) => id === selected)) choices.push([selected, ticket.assignee]);
      userSelect.innerHTML = options([['', 'Não atribuído'], ...choices], selected);
    };
    pickOwners(ticket.assignee_id);
    teamSelect?.addEventListener('change', () => pickOwners(null));
    onSubmit(props, async values => {
      const changes = Object.fromEntries([...values].map(([key, value]) => [key, key.endsWith('_id') ? nullableId(value) : value]).filter(([key, value]) => ticket[key] !== value));
      if (!Object.keys(changes).length) { toast('As propriedades já estão atualizadas.'); return; }
      if (changes.status === 'cancelled' && !await confirmAction('Cancelar chamado', `Deseja cancelar ${ticket.code}?`, 'Cancelar chamado')) return;
      await update(changes, 'Propriedades atualizadas.');
    });
  }

  root.querySelector('[data-edit]')?.addEventListener('click', () => {
    const dialog = openDialog('Editar chamado', `<form class="form-stack"><label>Título<input name="title" minlength="5" maxlength="160" required value="${esc(ticket.title)}"></label>
      <label>Descrição<textarea name="description" minlength="10" maxlength="12000" required>${esc(ticket.description)}</textarea></label>${errorSlot}
      <div class="form-actions">${button('Cancelar', '', '', 'data-close')}<button class="button primary" type="submit">Salvar alterações</button></div></form>`);
    onSubmit(dialog.querySelector('form'), async values => {
      await update(Object.fromEntries(values), 'Chamado atualizado.'); dialog.close();
    });
  });

  const reply = root.querySelector('#reply-form');
  if (reply) onSubmit(reply, async values => {
    await api(`/tickets/${ticket.id}/comments`, { method: 'POST', body: { body: values.get('body'), internal: values.has('internal') } });
    toast(values.has('internal') ? 'Nota interna adicionada.' : 'Mensagem enviada.'); ctx.refresh();
  });

  root.querySelectorAll('[data-file]').forEach(control => control.addEventListener('click', () => busy(control, async () => {
    const file = files.find(item => item.id === Number(control.dataset.file));
    const blob = await api(`/tickets/${ticket.id}/attachments/${file.id}`, { binary: true });
    download(blob, file.filename);
  })));

  root.querySelector('[data-upload]')?.addEventListener('click', () => {
    const dialog = openDialog('Adicionar anexos', `<form class="form-stack"><label>Arquivos<input type="file" name="files" multiple required><span class="muted small">Até quatro arquivos, com 5 MB por arquivo.</span></label>${errorSlot}<div class="form-actions"><button type="submit" class="button primary">Enviar arquivos</button></div></form>`);
    onSubmit(dialog.querySelector('form'), async values => {
      const files = values.getAll('files');
      if (files.length > 4 || files.some(file => !file.size || file.size > 5 * 1024 * 1024)) throw new Error('Selecione até quatro arquivos não vazios de no máximo 5 MB.');
      await api(`/tickets/${ticket.id}/attachments`, { method: 'POST', body: values });
      dialog.close(); toast('Anexos adicionados.'); ctx.refresh();
    });
  });

  root.querySelector('[data-escalate]')?.addEventListener('click', event => busy(event.currentTarget, async () => {
    await api(`/tickets/${ticket.id}/escalate`, { method: 'POST' });
    toast('Chamado escalado.'); ctx.refresh();
  }));

  const clockNodes = root.querySelectorAll('[data-clock]');
  const current = sla.filter(target => target.cycle === ticket.sla_cycle);
  const difference = +new Date(server_time) - Date.now();
  const tick = () => {
    clockNodes.forEach((node, index) => {
      const target = current[index];
      const now = Date.now() + difference;
      const remaining = (+new Date(target.deadline) - now) / 60000;
      const expired = Boolean(target.breached_at) || (!target.completed_at && !target.paused_at && !target.cancelled_at && remaining <= 0);
      node.classList.toggle('error-text', expired);
      node.textContent = expired ? (target.completed_at || target.cancelled_at ? 'SLA violado' : `SLA vencido há ${duration(Math.max(0, -remaining))}`)
        : target.paused_at ? 'SLA pausado' : target.completed_at ? `Cumprido em ${fullDate(target.completed_at, timezone)}`
        : target.cancelled_at ? 'Meta encerrada' : `${duration(remaining)} restantes`;
    });
  };
  tick();
  const timer = setInterval(tick, 10000);
  signal.addEventListener('abort', () => clearInterval(timer), { once: true });
}
