import { api, queryString } from './api.js';
import { openDialog } from './dialog.js';
import { icon } from './icons.js';
import { avatar, busy, button, esc, fullDate, iconButton, number, preference, roleLabels, statusBadge, toast } from './ui.js';

export const navGroups = [
  ['Principal', [['dashboard', 'Dashboard', 'grid'], ['tickets', 'Todos os chamados', 'ticket'], ['mine', 'Meus chamados', 'user'], ['create', 'Criar chamado', 'plus']]],
  ['Gerenciamento', [['queue', 'Fila de atendimento', 'inbox'], ['teams', 'Equipes', 'layers'], ['owners', 'Responsáveis', 'users'], ['sla', 'Controle de SLA', 'timer'], ['reports', 'Relatórios', 'chart']]],
  ['Administração', [['users', 'Usuários', 'users'], ['categories', 'Categorias', 'tags'], ['settings', 'Configurações', 'settings'], ['audit', 'Auditoria', 'shield']]]
];

export const staffPages = navGroups[1][1].map(([route]) => route);
export const adminPages = navGroups[2][1].map(([route]) => route);

function searchDialog() {
  const dialog = openDialog('Pesquisar chamados', `<form class="global-search-form"><label class="ticket-search">${icon('search')}<span class="sr-only">Pesquisar por título ou código</span><input type="search" name="q" maxlength="160" placeholder="Busque por título ou código…" required autofocus></label></form><div class="search-results" aria-live="polite"><p class="muted small search-prompt">Digite para buscar em seus chamados.</p></div>`);
  const form = dialog.querySelector('form');
  const input = form.elements.q;
  const results = dialog.querySelector('.search-results');
  let pending;
  let controller;
  input.addEventListener('input', () => {
    clearTimeout(pending); controller?.abort();
    const query = input.value.trim();
    if (!query) { results.innerHTML = '<p class="muted small search-prompt">Digite para buscar em seus chamados.</p>'; return; }
    pending = setTimeout(async () => {
      controller = new AbortController();
      const current = controller.signal;
      results.innerHTML = '<p class="muted small search-prompt">Buscando…</p>';
      try {
        const { items, total } = await api(`/tickets${queryString({ q: query, size: 7 })}`, { signal: current });
        if (current.aborted) return;
        results.innerHTML = items.length ? items.map(ticket => `<a class="search-result" href="#/ticket/${ticket.id}"><span><span class="ticket-code">${esc(ticket.code)}</span><span class="strong">${esc(ticket.title)}</span></span>${statusBadge(ticket.status)}</a>`).join('') +
          (total > items.length ? `<a class="text-link search-prompt" href="#/tickets${queryString({ q: query })}">Ver ${number(total)} resultados</a>` : '') : '<p class="muted small search-prompt">Nenhum chamado encontrado.</p>';
      } catch (error) { if (!current.aborted) results.textContent = error.message; }
    }, 220);
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!input.value.trim()) return;
    dialog.close(); location.hash = `#/tickets${queryString({ q: input.value.trim() })}`;
  });
  results.addEventListener('click', event => { if (event.target.closest('a')) dialog.close(); });
  dialog.addEventListener('close', () => { clearTimeout(pending); controller?.abort(); }, { once: true });
  input.focus();
}

export function initializeShell(session) {
  const topbar = document.querySelector('#topbar');
  const navigation = document.querySelector('#navigation');
  const workspace = document.querySelector('#workspace');
  const sidebar = document.querySelector('#sidebar');
  const scrim = document.querySelector('#scrim');
  const mobile = matchMedia('(max-width: 900px)');
  const shortcut = /Mac/i.test(navigator.platform) ? '⌘ K' : 'Ctrl K';
  topbar.innerHTML = `<div class="top-left">${iconButton('Recolher ou expandir navegação', 'panel', 'id="sidebar-toggle" aria-controls="sidebar"')}<div id="breadcrumbs" class="breadcrumbs" aria-label="Localização"></div></div>
    <div class="top-right"><button class="search-trigger" type="button" aria-label="Pesquisar chamados" aria-keyshortcuts="Control+k Meta+k" data-search>${icon('search')}<span>Pesquisar chamados…</span><kbd>${shortcut}</kbd></button>
    <div class="menu-anchor notifications-anchor">${iconButton('Notificações', 'bell', 'data-toggle="notifications" aria-controls="notification-popup" aria-expanded="false"')}<span class="notify-count" data-unread hidden></span>
    <section class="popover notifications-popover" id="notification-popup" data-popup="notifications" aria-label="Notificações" hidden><div class="popover-heading"><h2 class="section-title">Notificações</h2>${button('Marcar todas como lidas', '', 'ghost compact', 'data-read-all')}</div><div class="notification-list" data-notifications></div><div class="notice-pages" data-notice-pages hidden>${button('Mais recentes', '', 'compact ghost', 'data-notice-step="-1"')}${button('Mais antigas', '', 'compact ghost', 'data-notice-step="1"')}</div></section></div>
    <div class="top-divider"></div><div class="menu-anchor"><button type="button" class="profile-button" aria-label="Menu do perfil" aria-controls="profile-popup" aria-expanded="false" data-toggle="profile">
      ${avatar(session.user.name)}<span class="profile-copy"><span class="profile-name">${esc(session.user.name)}</span><span class="profile-role">${esc(roleLabels[session.user.role])}</span></span>${icon('down')}</button>
    <div class="popover" id="profile-popup" data-popup="profile" hidden><button type="button" class="menu-item" data-theme-toggle></button><button type="button" class="menu-item" data-logout>${icon('logout')}Sair da conta</button></div></div></div>`;
  const toggle = topbar.querySelector('#sidebar-toggle');
  const notifications = topbar.querySelector('[data-notifications]');
  const unread = topbar.querySelector('[data-unread]');
  const theme = topbar.querySelector('[data-theme-toggle]');
  const readAll = topbar.querySelector('[data-read-all]');
  const noticePages = topbar.querySelector('[data-notice-pages]');
  let noticePage = 1;
  let queue = 0;
  let current = 'dashboard';
  let version = 0;

  function setThemeLabel() {
    const next = document.documentElement.dataset.theme === 'dark' ? ['sun', 'Modo claro'] : ['moon', 'Modo escuro'];
    theme.innerHTML = `${icon(next[0])}${next[1]}`;
  }
  setThemeLabel();

  function renderNavigation() {
    const isAdmin = session.user.role === 'admin';
    const isStaff = session.user.role !== 'requester';
    navigation.innerHTML = navGroups.filter((_, index) => index === 0 || (index === 1 && isStaff) || (index === 2 && isAdmin)).map(([label, items]) => `<div class="nav-group"><p class="nav-label">${label}</p>${items.map(([id, name, glyph]) => `<a class="nav-link" href="#/${id}" aria-label="${name}" title="${name}" ${id === current || (id === 'tickets' && current === 'ticket') ? 'aria-current="page"' : ''}>${icon(glyph)}<span class="nav-text">${name}</span>${id === 'queue' && queue ? `<span class="nav-count" aria-hidden="true">${queue > 99 ? '99+' : number(queue)}</span>` : ''}</a>`).join('')}</div>`).join('');
    workspace.innerHTML = `<div class="workspace-card" title="${esc(session.workspace_name)}"><span class="workspace-logo">${icon('building')}</span><div class="truncate"><p class="workspace-name truncate">${esc(session.workspace_name === 'Nexus Desk' ? 'Nexus Workspace' : session.workspace_name)}</p><p class="workspace-caption">${session.demo ? 'Ambiente de demonstração' : 'Central de atendimento'}</p></div></div>`;
  }

  function setRoute(name, title) {
    current = name;
    topbar.querySelector('#breadcrumbs').innerHTML = `<span>Workspace</span>${icon('right')}<strong class="truncate">${esc(title)}</strong>`;
    renderNavigation();
  }

  function syncSidebar() {
    const isOpen = document.body.classList.contains('mobile-menu-open');
    sidebar.inert = mobile.matches && !isOpen;
    scrim.hidden = !mobile.matches || !isOpen;
    toggle.setAttribute('aria-expanded', String(mobile.matches ? isOpen : document.documentElement.dataset.sidebar !== 'collapsed'));
  }
  function closeSidebar(restore = false) {
    if (!document.body.classList.contains('mobile-menu-open')) return;
    document.body.classList.remove('mobile-menu-open'); syncSidebar();
    if (restore) toggle.focus();
  }
  syncSidebar();
  mobile.addEventListener('change', () => { closeSidebar(); syncSidebar(); });
  toggle.addEventListener('click', () => {
    if (mobile.matches) {
      if (document.body.classList.contains('mobile-menu-open')) closeSidebar(true);
      else { document.body.classList.add('mobile-menu-open'); syncSidebar(); navigation.querySelector('[aria-current]')?.focus(); }
    } else {
      const state = document.documentElement.dataset.sidebar === 'collapsed' ? 'expanded' : 'collapsed';
      document.documentElement.dataset.sidebar = state; preference('sidebar', state); syncSidebar();
    }
  });
  scrim.addEventListener('click', () => closeSidebar(true));
  sidebar.addEventListener('click', event => { if (event.target.closest('a')) closeSidebar(); });

  function closeMenus(restore = false) {
    topbar.querySelectorAll('[data-toggle][aria-expanded="true"]').forEach(control => {
      control.setAttribute('aria-expanded', 'false');
      topbar.querySelector(`[data-popup="${control.dataset.toggle}"]`).hidden = true;
      if (restore) control.focus();
    });
  }

  async function refreshNotifications(showError = false) {
    const stamp = ++version;
    try {
      const data = await api(`/notifications${queryString({ page: noticePage })}`);
      if (stamp !== version) return;
      if (!data.items.length && noticePage > 1) { noticePage = 1; return refreshNotifications(showError); }
      unread.hidden = !data.unread;
      unread.textContent = data.unread > 99 ? '99+' : number(data.unread);
      topbar.querySelector('[data-toggle="notifications"]').setAttribute('aria-label', data.unread ? `Notificações, ${data.unread} não lidas` : 'Notificações');
      readAll.disabled = !data.unread;
      noticePages.hidden = noticePage === 1 && !data.has_more;
      noticePages.querySelector('[data-notice-step="-1"]').disabled = noticePage === 1;
      noticePages.querySelector('[data-notice-step="1"]').disabled = !data.has_more;
      notifications.innerHTML = data.items.length ? data.items.map(item => `<button class="notification${item.read_at ? '' : ' unread'}" data-notice="${item.id}" data-ticket="${item.ticket_id}" type="button"><span class="status-dot" aria-hidden="true"></span><span>${!item.read_at ? '<span class="sr-only">Não lida. </span>' : ''}${esc(item.message)}<time datetime="${esc(item.created_at)}">${fullDate(item.created_at, session.timezone)}</time></span></button>`).join('') : '<p class="muted small search-prompt">Você está em dia. Nenhuma notificação.</p>';
    } catch (error) { if (stamp === version && showError) notifications.textContent = error.message; }
  }

  async function refreshQueue() {
    if (session.user.role === 'requester') return;
    try {
      const data = await api('/tickets?view=queue&size=1');
      if (data.total !== queue) {
        queue = data.total;
        const link = navigation.querySelector('[href="#/queue"]');
        link?.querySelector('.nav-count')?.remove();
        if (queue && link) {
          const count = document.createElement('span'); count.className = 'nav-count'; count.setAttribute('aria-hidden', 'true');
          count.textContent = queue > 99 ? '99+' : number(queue); link.append(count);
        }
      }
    } catch { /* The queue page reports errors and supports retry. */ }
  }

  topbar.addEventListener('click', async event => {
    const control = event.target.closest('button');
    if (!control) return;
    if ('search' in control.dataset) { closeMenus(); searchDialog(); }
    if (control.dataset.toggle) {
      const open = control.getAttribute('aria-expanded') !== 'true';
      closeMenus();
      if (open) {
        control.setAttribute('aria-expanded', 'true');
        topbar.querySelector(`[data-popup="${control.dataset.toggle}"]`).hidden = false;
        if (control.dataset.toggle === 'notifications') refreshNotifications(true);
      }
    }
    if ('themeToggle' in control.dataset) {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next; preference('theme', next); setThemeLabel(); closeMenus(true);
    }
    if ('logout' in control.dataset) busy(control, async () => { await api('/auth/logout', { method: 'POST' }); location.replace('/login.html'); });
    if ('readAll' in control.dataset) {
      await busy(control, async () => {
        await api('/notifications/read', { method: 'PATCH', body: {} }); toast('Notificações marcadas como lidas.');
      });
      refreshNotifications(true);
    }
    if (control.dataset.noticeStep) {
      noticePage = Math.max(1, noticePage + Number(control.dataset.noticeStep));
      refreshNotifications(true).then(() => { notifications.scrollTop = 0; });
    }
    if (control.dataset.notice) busy(control, async () => {
      await api('/notifications/read', { method: 'PATCH', body: { id: Number(control.dataset.notice) } });
      closeMenus(); location.hash = `#/ticket/${control.dataset.ticket}`; refreshNotifications();
    });
  });
  document.addEventListener('pointerdown', event => { if (!event.target.closest('.menu-anchor')) closeMenus(); });
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); closeMenus(); searchDialog(); }
    if (event.key === 'Escape' && !document.querySelector('#dialog').open) { closeMenus(true); closeSidebar(true); }
  });

  const refresh = () => { refreshQueue(); refreshNotifications(); };
  refresh(); setInterval(refresh, 30000);
  return { setRoute, refresh, closeMenus };
}
