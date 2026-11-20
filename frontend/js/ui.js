import { icon } from './icons.js';

export const statusLabels = { open: 'Aberto', triage: 'Em triagem', in_progress: 'Em andamento', waiting_requester: 'Aguardando solicitante', waiting_third_party: 'Aguardando terceiro', resolved: 'Resolvido', closed: 'Fechado', cancelled: 'Cancelado' };
export const priorityLabels = { low: 'Baixa', medium: 'Média', high: 'Alta', critical: 'Crítica' };
export const roleLabels = { admin: 'Administrador', manager: 'Gestor', agent: 'Atendente', requester: 'Solicitante' };
export const slaLabels = { on_track: 'No prazo', warning: 'Próximo do vencimento', breached: 'Violado', paused: 'Pausado', met: 'Cumprido', cancelled: 'Encerrado' };
export const fieldLabels = { title: 'Título', description: 'Descrição', status: 'Status', priority: 'Prioridade', category_id: 'Categoria', team_id: 'Equipe', assignee_id: 'Responsável' };
export const actionLabels = { created: 'Criou o chamado', updated: 'Atualizou o chamado', comment: 'Enviou uma resposta', internal_comment: 'Adicionou uma nota interna', attachment: 'Adicionou um anexo', escalated: 'Escalou o chamado', sla_breached: 'Prazo de SLA violado', sla_paused: 'Pausou o SLA', sla_resumed: 'Retomou o SLA', teams_created: 'Criou uma equipe', teams_updated: 'Atualizou uma equipe', categories_created: 'Criou uma categoria', categories_updated: 'Atualizou uma categoria', users_created: 'Criou um usuário', users_updated: 'Atualizou um usuário', settings_updated: 'Atualizou as configurações', sla_policy: 'Atualizou uma política de SLA', holiday_added: 'Cadastrou um feriado', holiday_removed: 'Removeu um feriado' };
export const phaseLabels = { response: 'Primeira resposta', resolution: 'Resolução' };
export const terminal = ['resolved', 'closed', 'cancelled'];

const statusTones = { open: 'blue', triage: 'purple', in_progress: 'purple', waiting_requester: 'amber', waiting_third_party: 'amber', resolved: 'green', closed: 'gray', cancelled: 'red' };
const priorityTones = { low: 'gray', medium: 'blue', high: 'amber', critical: 'red' };
const priorityIcons = { low: 'low', medium: 'medium', high: 'high', critical: 'bolt' };
const slaTones = { on_track: 'green', warning: 'amber', breached: 'red', paused: 'gray', met: 'green', cancelled: 'gray' };
const replacements = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export const esc = value => String(value ?? '').replace(/[&<>"']/g, character => replacements[character]);
export const statusBadge = value => `<span class="badge dot tone-${statusTones[value] ?? 'gray'}">${esc(statusLabels[value] ?? value)}</span>`;
export const priorityBadge = value => `<span class="badge tone-${priorityTones[value] ?? 'gray'}">${icon(priorityIcons[value])}${esc(priorityLabels[value] ?? value)}</span>`;
export const slaBadge = value => `<span class="badge dot tone-${slaTones[value] ?? 'gray'}">${esc(slaLabels[value] ?? '—')}</span>`;
export const number = value => new Intl.NumberFormat('pt-BR').format(value ?? 0);
export const shortDate = (value, timezone) => value ? new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', timeZone: timezone }).format(new Date(value)).replace('.', '') : '—';
export const fullDate = (value, timezone) => value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: timezone }).format(new Date(value)) : '—';

export function duration(minutes) {
  const total = Math.max(0, Math.ceil(minutes));
  const days = Math.floor(total / 1440);
  const hours = Math.floor(total % 1440 / 60);
  const rest = total % 60;
  return [days && `${days}d`, hours && `${hours}h`, (rest || !total) && `${rest}min`].filter(Boolean).join(' ');
}

export function avatar(name = '') {
  const initials = name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]).join('').toUpperCase();
  const tone = [...name].reduce((total, character) => total + character.codePointAt(0), 0) % 6;
  return `<span class="avatar a${tone}" aria-hidden="true">${esc(initials || '—')}</span>`;
}

export const person = name => name ? `<span class="person">${avatar(name)}<span>${esc(name)}</span></span>` : '<span class="muted">Não atribuído</span>';

export const button = (label, glyph, className = '', extra = '') => `<button class="button ${className}" type="button" ${extra}>${glyph ? icon(glyph) : ''}${esc(label)}</button>`;
export const iconButton = (label, glyph, extra = '') => `<button class="icon-button" type="button" aria-label="${esc(label)}" title="${esc(label)}" ${extra}>${icon(glyph)}</button>`;
export const actionLink = (label, glyph, href, className = 'primary') => `<a class="button ${className}" href="${esc(href)}">${glyph ? icon(glyph) : ''}${esc(label)}</a>`;
export const pageHead = (title, description, actions = '') => `<div class="page-head"><div><h1>${esc(title)}</h1>${description ? `<p>${esc(description)}</p>` : ''}</div>${actions ? `<div class="page-actions">${actions}</div>` : ''}</div>`;
export const panel = (title, body, subtitle = '') => `<section class="panel"><div class="panel-head"><div><h2 class="section-title">${esc(title)}</h2>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div></div><div class="panel-body">${body}</div></section>`;
export const options = (records, selected) => records.map(([value, label]) => `<option value="${esc(value)}"${String(value) === String(selected ?? '') ? ' selected' : ''}>${esc(label)}</option>`).join('');
export const lookupOptions = (records, selected) => records.filter(record => record.active !== false || record.id === selected).map(record => [record.id, record.name]);
export const skeleton = () => `<div class="skeleton skeleton-title"></div><div class="metric-grid" aria-label="Carregando"><div class="skeleton skeleton-card"></div><div class="skeleton skeleton-card"></div><div class="skeleton skeleton-card"></div><div class="skeleton skeleton-card"></div></div><div class="skeleton skeleton-chart"></div>`;

export function empty(title, description = '', action = '') {
  return `<div class="empty"><svg viewBox="0 0 84 66" fill="none" aria-hidden="true"><rect x="13" y="12" width="58" height="43" rx="10" fill="var(--primary-tint)"/><path d="M24 36l5-13h26l5 13v13H24z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M24 36h12l3 4h6l3-4h12M42 4v3M75 18l3-2M8 50l-3 2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg><h2>${esc(title)}</h2>${description ? `<p>${esc(description)}</p>` : ''}${action}</div>`;
}

export function toast(message, error = false) {
  const host = document.querySelector('#toasts');
  if (!host) return;
  const item = document.createElement('div');
  item.className = `toast${error ? ' error' : ''}`;
  item.innerHTML = `${icon(error ? 'alert' : 'checkCircle')}<span>${esc(message)}</span>${iconButton('Fechar aviso', 'close')}`;
  const timer = setTimeout(() => item.remove(), error ? 7500 : 4500);
  item.querySelector('button').addEventListener('click', () => { clearTimeout(timer); item.remove(); });
  host.append(item);
}

export async function busy(control, run, report = message => toast(message, true)) {
  if (control?.disabled) return;
  if (control) { control.disabled = true; control.setAttribute('aria-busy', 'true'); }
  try { return await run(); }
  catch (error) { report(error.message); }
  finally { if (control) { control.disabled = false; control.removeAttribute('aria-busy'); } }
}

export function onSubmit(form, run) {
  form.addEventListener('submit', event => {
    event.preventDefault();
    const error = form.querySelector('[role="alert"]');
    if (error) error.hidden = true;
    busy(event.submitter ?? form.querySelector('button[type="submit"]'), () => run(new FormData(form), form), message => {
      if (error) { error.textContent = message; error.hidden = false; }
      else toast(message, true);
    });
  });
}

export function preference(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(`nexus.${key}`);
    localStorage.setItem(`nexus.${key}`, value);
  } catch { /* Preferences are optional when storage is unavailable. */ }
  return null;
}

export function pagination(total, page, size) {
  const pages = Math.max(1, Math.ceil(total / size));
  const range = total ? `${Math.min((page - 1) * size + 1, total)}–${Math.min(page * size, total)} de ${number(total)}` : '0 resultados';
  return `<div class="table-foot"><span>${range}</span><div>${iconButton('Página anterior', 'left', `data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}`)}<span class="numeric">${number(page)} / ${number(pages)}</span>${iconButton('Próxima página', 'right', `data-page="${page + 1}" ${page >= pages ? 'disabled' : ''}`)}</div></div>`;
}

export function table(headers, rows, emptyMarkup = '') {
  if (!rows.length && emptyMarkup) return emptyMarkup;
  return `<div class="table-wrap" tabindex="0" role="region" aria-label="Tabela de resultados"><table><thead><tr>${headers.map(text => `<th scope="col">${text}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}
