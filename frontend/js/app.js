import { api } from './api.js';
import { initializeShell, adminPages, staffPages } from './shell.js';
import { button, empty, skeleton } from './ui.js';
import { dashboard } from './pages/dashboard.js';
import { create, tickets } from './pages/tickets.js';
import { detail } from './pages/detail.js';
import { audit, categories, owners, settings, sla, teams, users } from './pages/management.js';

const main = document.querySelector('#conteudo');
const shell = document.querySelector('#shell');
const pages = {
  dashboard: ['Visão geral', dashboard], tickets: ['Todos os chamados', tickets], mine: ['Meus chamados', tickets], create: ['Criar chamado', create],
  queue: ['Fila de atendimento', tickets], teams: ['Equipes', teams], owners: ['Responsáveis', owners], sla: ['Controle de SLA', sla],
  reports: ['Relatórios', ctx => dashboard(ctx, true)], users: ['Usuários', users], categories: ['Categorias', categories],
  settings: ['Configurações', settings], audit: ['Auditoria', audit], ticket: ['Detalhes do chamado', detail]
};

function login() {
  const next = location.hash.startsWith('#/') ? `?next=${encodeURIComponent(location.hash)}` : '';
  location.replace(`/login.html${next}`);
}
window.addEventListener('nexus:session-expired', login);

function readRoute() {
  const hash = location.hash.slice(1) || '/dashboard';
  const [path, search] = hash.split('?');
  const match = /^\/([a-z]+)(?:\/(\d{1,10}))?\/?$/.exec(path);
  const name = match?.[1];
  const id = match?.[2];
  return { name: Object.hasOwn(pages, name) && (name === 'ticket' ? Boolean(id) : !id) ? name : 'missing', id, params: new URLSearchParams(search) };
}

document.querySelector('.skip-link').addEventListener('click', event => { event.preventDefault(); main.focus(); });

async function initialize() {
  let session;
  try { session = await api('/auth/me'); }
  catch (error) {
    if (error.status === 401) return;
    shell.removeAttribute('aria-busy');
    main.innerHTML = `<div class="panel">${empty('Não foi possível abrir o Nexus Desk', error.message, button('Tentar de novo', 'refresh', '', 'data-retry'))}</div>`;
    main.querySelector('[data-retry]').addEventListener('click', () => location.reload());
    return;
  }
  const frame = initializeShell(session);
  let controller;

  async function render(quiet = false) {
    controller?.abort();
    controller = new AbortController();
    const { signal } = controller;
    const route = readRoute();
    const [title, layout] = pages[route.name] ?? ['Página não encontrada', null];
    const permitted = (!adminPages.includes(route.name) || session.user.role === 'admin') && (!staffPages.includes(route.name) || session.user.role !== 'requester');
    document.title = `${title} | Nexus Desk`;
    frame.setRoute(route.name, title);
    const root = document.createElement('div');
    root.className = 'page-view';
    main.setAttribute('aria-busy', 'true');
    if (!quiet) {
      root.innerHTML = skeleton();
      main.replaceChildren(root);
      window.scrollTo(0, 0);
    }
    const refresh = () => { if (!signal.aborted) { frame.refresh(); render(true); } };
    try {
      if (!layout || !permitted) {
        root.innerHTML = `<div class="panel">${empty(!layout ? 'Página não encontrada' : 'Acesso restrito', !layout ? 'Confira o endereço ou volte ao dashboard.' : 'Seu perfil não tem acesso a esta página.', '<a class="button" href="#/dashboard">Voltar ao dashboard</a>')}</div>`;
      } else {
        await layout({ root, route, session, signal, refresh, request: (path, options = {}) => api(path, { ...options, signal }) });
      }
    } catch (error) {
      if (signal.aborted) return;
      const sidebar = error.status === 404 && route.name === 'ticket' ? '<a class="button" href="#/tickets">Ver chamados disponíveis</a>' : button('Tentar de novo', 'refresh', '', 'data-retry');
      root.innerHTML = `<div class="panel">${empty(error.status === 404 ? 'Recurso não encontrado' : 'Não foi possível carregar esta página', error.message, sidebar)}</div>`;
      root.querySelector('[data-retry]')?.addEventListener('click', refresh);
    } finally {
      if (!signal.aborted) {
        if (quiet) main.replaceChildren(root);
        main.removeAttribute('aria-busy');
        shell.removeAttribute('aria-busy');
      }
    }
  }

  window.addEventListener('hashchange', () => {
    document.querySelector('#dialog').close(); frame.closeMenus(); render(); main.focus({ preventScroll: true });
  });
  await render();
}

await initialize();
