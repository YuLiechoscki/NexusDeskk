import { api, queryString } from '../api.js';
import { confirmAction, openDialog } from '../dialog.js';
import { icon } from '../icons.js';
import { actionLink, busy, button, empty, esc, iconButton, lookupOptions, number, onSubmit, options, pageHead, pagination, person,
  preference, priorityBadge, priorityLabels, shortDate, slaBadge, statusBadge, statusLabels, table, terminal, toast } from '../ui.js';

const names = { tickets: ['Todos os chamados', 'Pesquise, filtre e acompanhe os chamados que você pode acessar.'], mine: ['Meus chamados', 'Acompanhe seus pedidos e os chamados atribuídos a você.'], queue: ['Fila de atendimento', 'Acompanhe os chamados ativos que aguardam um responsável.'] };
const sortOptions = [['newest', 'Mais recentes'], ['oldest', 'Mais antigos'], ['updated', 'Última atualização'], ['priority', 'Maior prioridade'], ['title', 'Título (A–Z)']];
const states = Object.entries(statusLabels);
const priorityOptions = Object.entries(priorityLabels);
const tabs = { table: 'Tabela', board: 'Kanban' };

function filter(key, label, entries, selected) {
  return `<label><span class="sr-only">${label}</span><select name="${key}">${options([['', label], ...entries], selected)}</select></label>`;
}

function renderTable(items, visibleSelection, timezone, staff) {
  const first = staff ? ['<input type="checkbox" aria-label="Selecionar todos nesta página" data-all>'] : [];
  const headers = [...first, 'Chamado', 'Status', 'Prioridade', 'Responsável', 'SLA', 'Abertura', '<span class="sr-only">Ações</span>'];
  const rows = items.map(ticket => `<tr${visibleSelection.has(ticket.id) ? ' class="selected"' : ''}>
    ${staff ? `<td>${ticket.permissions.work ? `<input type="checkbox" data-select="${ticket.id}" aria-label="Selecionar ${esc(ticket.code)}" ${visibleSelection.has(ticket.id) ? 'checked' : ''}>` : ''}</td>` : ''}
    <td><a class="ticket-link" href="#/ticket/${ticket.id}"><span class="ticket-code">${esc(ticket.code)}</span><span class="strong">${esc(ticket.title)}</span></a><span class="ticket-category">${esc(ticket.category)}</span></td>
    <td>${statusBadge(ticket.status)}</td><td>${priorityBadge(ticket.priority)}</td><td>${staff ? person(ticket.assignee) : esc(ticket.assignee || 'Não atribuído')}</td>
    <td>${slaBadge(ticket.sla_state)}</td><td class="muted nowrap">${shortDate(ticket.created_at, timezone)}</td><td>${iconButton(`Ações de ${ticket.code}`, 'more', `data-row="${ticket.id}" aria-haspopup="dialog"`)}</td></tr>`);
  return table(headers, rows, empty('Nenhum chamado encontrado', 'Ajuste os filtros ou abra um chamado.', actionLink('Criar chamado', 'plus', '#/create', 'compact')));
}

function renderBoard(items, pickedStatus) {
  return `<div class="kanban" tabindex="0" aria-label="Quadro Kanban">${states.filter(([key]) => !pickedStatus || pickedStatus === key).map(([key, state]) => {
    const matches = items.filter(ticket => ticket.status === key);
    return `<section class="kanban-column" data-column="${key}" aria-label="${state}"><div class="kanban-head">${statusBadge(key)}<span>${number(matches.length)}</span></div>
      ${matches.map(ticket => `<article class="panel kanban-card" data-card="${ticket.id}" draggable="${ticket.permissions.work}"><div class="kanban-card-top"><span class="ticket-code">${esc(ticket.code)}</span>${iconButton(`Ações de ${ticket.code}`, 'more', `data-row="${ticket.id}"`)}</div>
      <a class="strong" href="#/ticket/${ticket.id}">${esc(ticket.title)}</a><div class="kanban-card-meta">${priorityBadge(ticket.priority)}${slaBadge(ticket.sla_state)}</div><span class="small muted">${esc(ticket.assignee ?? 'Não atribuído')}</span></article>`).join('') || '<p class="kanban-empty">Sem chamados</p>'}</section>`;
  }).join('')}</div>`;
}

async function rowActions(ticket, update) {
  const active = !terminal.includes(ticket.status);
  const action = ticket.permissions.work ? `<form class="form-stack" id="row-status"><label>Status<select name="status">${options(states, ticket.status)}</select></label>
    <p role="alert" class="error-text" hidden></p><div class="form-actions"><button type="submit" class="button primary">Atualizar status</button></div></form>` : '';
  const dialog = openDialog(`Ações · ${ticket.code}`, `<div class="form-stack"><p>${esc(ticket.title)}</p><div class="inline">${statusBadge(ticket.status)}${priorityBadge(ticket.priority)}</div>${action}
    <div class="form-actions">${active && ticket.priority === 'critical' && ticket.permissions.work && !ticket.escalated_at ? button('Escalar', 'flag', '', 'data-escalate') : ''}${actionLink('Abrir chamado', 'ticket', `#/ticket/${ticket.id}`, '')}</div></div>`);
  dialog.querySelector('a').addEventListener('click', () => dialog.close());
  const form = dialog.querySelector('#row-status');
  if (form) onSubmit(form, async values => {
    await api(`/tickets/${ticket.id}`, { method: 'PATCH', body: { status: values.get('status') } });
    dialog.close(); toast('Status atualizado.'); await update();
  });
  dialog.querySelector('[data-escalate]')?.addEventListener('click', event => busy(event.currentTarget, async () => {
    await api(`/tickets/${ticket.id}/escalate`, { method: 'POST' });
    dialog.close(); toast('Chamado escalado.'); await update();
  }));
}

export async function tickets(ctx) {
  const { root, route, request, session, signal } = ctx;
  const staff = session.user.role !== 'requester';
  const view = { tickets: 'all', mine: 'mine', queue: 'queue' }[route.name];
  const directory = await request('/directory');
  const filters = Object.fromEntries(['q', 'status', 'priority', 'assignee_id', 'category_id', 'team_id', 'sort'].map(key => [key, route.params.get(key) ?? '']));
  let page = 1;
  let size = 10;
  let mode = preference('tickets-view') === 'board' ? 'board' : 'table';
  const selected = new Set();
  let data = { items: [], total: 0 };
  let counter = 0;
  let ticking;
  let dragged = null;
  let controller;
  signal.addEventListener('abort', () => { clearTimeout(ticking); controller?.abort(); }, { once: true });
  root.innerHTML = `${pageHead(...names[route.name], actionLink('Criar chamado', 'plus', '#/create'))}
    <section class="panel"><div class="ticket-toolbar">
      <div class="ticket-tools"><label class="ticket-search">${icon('search')}<span class="sr-only">Pesquisar chamados</span><input type="search" name="q" maxlength="160" placeholder="Buscar por título ou código…" value="${esc(filters.q)}"></label><div class="segmented" aria-label="Visualização">${Object.entries(tabs).map(([key, label]) => button(label, key, 'compact', `data-mode="${key}" aria-pressed="${mode === key}"`)).join('')}</div></div>
      <div class="ticket-filters">${filter('status', 'Todos os status', states, filters.status)}${filter('priority', 'Todas as prioridades', priorityOptions, filters.priority)}
      ${staff ? filter('assignee_id', 'Todos os responsáveis', [['none', 'Não atribuído'], ...lookupOptions(directory.people)], filters.assignee_id) : ''}
      ${filter('category_id', 'Todas as categorias', lookupOptions(directory.categories), filters.category_id)}${staff ? filter('team_id', 'Todas as equipes', lookupOptions(directory.teams), filters.team_id) : ''}
      <label class="sort-ticket"><span class="sr-only">Ordenar chamados</span><select name="sort">${options(sortOptions, filters.sort || 'newest')}</select></label>${button('Limpar', '', 'ghost compact', 'data-clear')}</div></div>
      <div data-bulk hidden></div><div data-results aria-live="polite"></div></section>`;
  const results = root.querySelector('[data-results]');
  const bulk = root.querySelector('[data-bulk]');

  function applySelection() {
    const inspect = [...results.querySelectorAll('[data-select]')];
    for (const item of inspect) {
      item.checked = selected.has(Number(item.dataset.select));
      item.closest('tr').classList.toggle('selected', item.checked);
    }
    const all = results.querySelector('[data-all]');
    if (all) {
      const checked = inspect.filter(item => item.checked).length;
      all.disabled = !inspect.length;
      all.indeterminate = checked > 0 && checked < inspect.length;
      all.checked = Boolean(inspect.length && checked === inspect.length);
    }
    bulk.hidden = selected.size === 0;
    bulk.innerHTML = selected.size ? `<div class="bulk-bar"><strong>${number(selected.size)} selecionado(s)</strong>${button('Alterar em lote', 'edit', 'compact', 'data-bulk-edit')}${button('Limpar seleção', '', 'ghost compact', 'data-bulk-clear')}</div>` : '';
  }

  async function refresh() {
    const version = ++counter;
    controller?.abort();
    controller = new AbortController();
    const batchSize = mode === 'board' ? 100 : size;
    results.setAttribute('aria-busy', 'true');
    results.innerHTML = '<div class="skeleton ticket-skeleton" aria-label="Carregando chamados"></div>';
    try {
      data = await api(`/tickets${queryString({ ...filters, view, page, size: batchSize })}`, { signal: controller.signal });
      if (version !== counter || signal.aborted) return;
      const last = Math.max(1, Math.ceil(data.total / batchSize));
      if (page > last) { page = last; return refresh(); }
      const listing = mode === 'board' ? renderBoard(data.items, filters.status) : renderTable(data.items, selected, session.timezone, staff);
      results.innerHTML = `${listing}${pagination(data.total, page, batchSize)}${mode === 'table' ? `<label class="page-size"><span>Por página</span><select name="page_size">${options([10, 25, 50].map(value => [value, value]), size)}</select></label>` : ''}`;
      applySelection();
    } catch (error) {
      if (version !== counter || signal.aborted) return;
      results.innerHTML = empty('Não foi possível carregar os chamados', error.message, button('Tentar de novo', 'refresh', '', 'data-retry'));
    } finally { if (version === counter) results.removeAttribute('aria-busy'); }
  }

  function updateFilter(input) {
    filters[input.name] = input.value;
    page = 1;
    selected.clear();
    applySelection();
    refresh();
  }

  root.querySelector('[name="q"]').addEventListener('input', event => {
    clearTimeout(ticking);
    const input = event.currentTarget;
    ticking = setTimeout(() => updateFilter(input), 250);
  });
  root.querySelector('.ticket-filters').addEventListener('change', event => updateFilter(event.target));
  results.addEventListener('change', event => {
    const { target } = event;
    if (target.name === 'page_size') { size = Number(target.value); page = 1; refresh(); return; }
    const checkboxes = target.matches('[data-all]') ? [...results.querySelectorAll('[data-select]')] : target.matches('[data-select]') ? [target] : [];
    for (const item of checkboxes) {
      const id = Number(item.dataset.select);
      if (target.checked) selected.add(id); else selected.delete(id);
    }
    applySelection();
  });
  root.addEventListener('click', event => {
    const control = event.target.closest('button');
    if (!control) return;
    if (control.dataset.mode && mode !== control.dataset.mode) {
      mode = control.dataset.mode; preference('tickets-view', mode); page = 1; selected.clear();
      root.querySelectorAll('[data-mode]').forEach(item => item.setAttribute('aria-pressed', String(item.dataset.mode === mode)));
      applySelection(); refresh();
    }
    if ('clear' in control.dataset) {
      clearTimeout(ticking);
      for (const key of Object.keys(filters)) {
        filters[key] = '';
        const input = root.querySelector(`[name="${key}"]`);
        if (input) input.value = key === 'sort' ? 'newest' : '';
      }
      page = 1; selected.clear(); applySelection(); refresh();
    }
    if (control.dataset.page) { page = Number(control.dataset.page); refresh(); }
    if ('retry' in control.dataset) refresh();
    if (control.dataset.row) {
      const ticket = data.items.find(ticket => ticket.id === Number(control.dataset.row));
      if (ticket) rowActions(ticket, refresh);
    }
    if ('bulkClear' in control.dataset) { selected.clear(); applySelection(); }
    if ('bulkEdit' in control.dataset) {
      const dialog = openDialog('Alterar chamados selecionados', `<form class="form-stack"><label>Status<select name="status">${options([['', 'Manter status'], ...states])}</select></label>
        <label>Prioridade<select name="priority">${options([['', 'Manter prioridade'], ...priorityOptions])}</select></label><p class="error-text" role="alert" hidden></p>
        <div class="form-actions">${button('Cancelar', '', '', 'data-close')}<button class="button primary" type="submit">Aplicar alterações</button></div></form>`);
      onSubmit(dialog.querySelector('form'), async values => {
        const changes = Object.fromEntries([...values].filter(([, value]) => value));
        if (!Object.keys(changes).length) throw new Error('Selecione o status ou a prioridade.');
        if (selected.size > 100) throw new Error('Selecione até 100 chamados por ação.');
        await api('/tickets/bulk', { method: 'PATCH', body: { ids: [...selected], changes } });
        dialog.close(); selected.clear(); toast('Chamados atualizados.'); await refresh();
      });
    }
  });
  results.addEventListener('dragstart', event => {
    const item = event.target.closest('[data-card][draggable="true"]');
    if (!item) return;
    dragged = Number(item.dataset.card);
    event.dataTransfer.setData('text/plain', String(dragged));
    event.dataTransfer.effectAllowed = 'move';
  });
  results.addEventListener('dragover', event => {
    const target = event.target.closest('[data-column]');
    if (!target || !dragged) return;
    event.preventDefault(); target.classList.add('drop-target');
  });
  results.addEventListener('dragleave', event => {
    const target = event.target.closest('[data-column]');
    if (target && !target.contains(event.relatedTarget)) target.classList.remove('drop-target');
  });
  results.addEventListener('drop', async event => {
    const column = event.target.closest('[data-column]');
    const ticket = data.items.find(ticket => ticket.id === dragged);
    if (!column || !ticket) return;
    event.preventDefault(); column.classList.remove('drop-target');
    const status = column.dataset.column;
    if (ticket.status === status) return;
    if (status === 'cancelled' && !await confirmAction('Cancelar chamado', `Deseja cancelar ${ticket.code}?`, 'Cancelar chamado')) return;
    try {
      await api(`/tickets/${ticket.id}`, { method: 'PATCH', body: { status } });
      toast('Chamado movido.'); await refresh();
    } catch (error) { toast(error.message, true); }
  });
  results.addEventListener('dragend', () => {
    dragged = null; results.querySelectorAll('.drop-target').forEach(item => item.classList.remove('drop-target'));
  });
  await refresh();
}

export async function create(ctx) {
  const { root, request } = ctx;
  const { categories } = await request('/directory');
  const active = lookupOptions(categories);
  root.innerHTML = `${pageHead('Criar chamado', 'Descreva a solicitação para que a equipe possa atendê-la.')}
    <section class="panel create-panel"><div class="panel-head"><h2 class="section-title">Dados da solicitação</h2></div><div class="panel-body">
    ${active.length ? `<form class="form-stack"><label>Título<input name="title" placeholder="Resuma sua solicitação" minlength="5" maxlength="160" required></label>
    <div class="form-row"><label>Categoria<select name="category_id" required>${options([['', 'Selecione uma categoria'], ...active])}</select></label><label>Prioridade<select name="priority">${options(priorityOptions, 'medium')}</select></label></div>
    <label>Descrição<textarea name="description" placeholder="Inclua o contexto, o impacto e como identificar o problema." minlength="10" maxlength="12000" required></textarea></label>
    <label>Anexos <input type="file" name="files" multiple><span class="muted small">Até quatro arquivos, com 5 MB por arquivo.</span></label>
    <p class="error-text" role="alert" hidden></p><div class="form-actions">${actionLink('Cancelar', '', '#/tickets', '')}<button class="button primary" type="submit">${icon('plus')}Criar chamado</button></div></form>` : empty('Nenhuma categoria ativa', 'Um administrador precisa cadastrar uma categoria antes de abrir chamados.')}</div></section>`;
  const form = root.querySelector('form');
  if (form) onSubmit(form, async values => {
    const files = values.getAll('files').filter(file => file.name);
    if (files.length > 4 || files.some(file => !file.size || file.size > 5 * 1024 * 1024)) throw new Error('Selecione até quatro arquivos não vazios de no máximo 5 MB.');
    values.delete('files');
    for (const file of files) values.append('files', file);
    const ticket = await api('/tickets', { method: 'POST', body: values });
    toast(`${ticket.code} criado com sucesso.`);
    location.hash = `#/ticket/${ticket.id}`;
  });
}
