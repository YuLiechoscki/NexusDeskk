import { icon } from './icons.js';
import { duration, esc, number, priorityLabels, statusLabels } from './ui.js';

const formatDate = date => new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', timeZone: 'UTC' }).format(new Date(date + 'T12:00:00Z')).replace('.', '');
const seriesKey = '<div class="chart-key"><span><i></i>Abertos</span><span class="series-green"><i></i>Resolvidos</span></div>';

function buckets(series) {
  const size = series.length > 31 ? 7 : series.length > 14 ? 2 : 1;
  const result = [];
  for (let index = 0; index < series.length; index += size) {
    const group = series.slice(index, index + size);
    result.push({ start: group[0].day, end: group.at(-1).day,
      created: group.reduce((total, point) => total + point.created, 0), resolved: group.reduce((total, point) => total + point.resolved, 0) });
  }
  return result;
}

function linePoints(points) {
  return points.map(([x, y], index) => {
    if (!index) return `M${x} ${y}`;
    const [px, py] = points[index - 1];
    const center = (px + x) / 2;
    return `C${center} ${py} ${center} ${y} ${x} ${y}`;
  }).join(' ');
}

export function trend(series) {
  const data = buckets(series);
  const step = Math.max(1, Math.ceil(Math.max(...data.flatMap(item => [item.created, item.resolved]), 1) / 4));
  const y = value => 147 - value / (step * 4) * 143;
  const x = index => 5 + index * 590 / Math.max(data.length - 1, 1);
  const a = linePoints(data.map((point, index) => [x(index), y(point.created)]));
  const b = linePoints(data.map((point, index) => [x(index), y(point.resolved)]));
  const ticks = data.filter((_, index) => [0, Math.round((data.length - 1) / 3), Math.round((data.length - 1) * 2 / 3), data.length - 1].includes(index));
  return `<section class="panel"><div class="panel-head"><div><h2 class="section-title">Evolução de chamados</h2><p>Aberturas e resoluções no período</p></div>${seriesKey}</div>
    <div class="panel-body"><div class="line-chart"><div class="line-axis" aria-hidden="true">${[4, 3, 2, 1, 0].map(n => `<span>${n * step}</span>`).join('')}</div>
    <div class="chart-plot" tabindex="0" aria-label="Evolução dos chamados. Use as setas para explorar os valores do gráfico.">
      <svg viewBox="0 0 600 151" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="line-fill" x2="0" y2="1"><stop stop-color="#695cf0" stop-opacity=".18"/><stop offset="1" stop-color="#695cf0" stop-opacity=".015"/></linearGradient></defs>
      ${[4, 3, 2, 1, 0].map(n => `<line x1="0" x2="600" y1="${y(n * step)}" y2="${y(n * step)}" class="chart-grid-line"/>`).join('')}
      <path d="${a} L${x(data.length - 1)} 147 L5 147 Z" class="chart-area"/><path d="${a}" class="chart-line"/><path d="${b}" class="chart-line series-green"/><g data-cursor visibility="hidden"><line class="chart-crosshair" y1="0" y2="147"/><circle class="chart-point" r="3.2"/></g>
      </svg><span class="chart-tooltip" role="status" hidden></span></div>
      <div class="chart-x" aria-hidden="true">${ticks.map(point => `<span>${formatDate(point.start)}</span>`).join('')}</div></div></div></section>`;
}

export function activateTrend(root, series) {
  const plot = root.querySelector('.chart-plot');
  if (!plot) return;
  const data = buckets(series);
  const step = Math.max(1, Math.ceil(Math.max(...data.flatMap(item => [item.created, item.resolved]), 1) / 4));
  const cursor = plot.querySelector('[data-cursor]');
  const line = cursor.querySelector('line');
  const circle = cursor.querySelector('circle');
  const tip = plot.querySelector('.chart-tooltip');
  let index = 0;
  const show = next => {
    index = Math.min(Math.max(next, 0), data.length - 1);
    const value = data[index];
    const fraction = index / Math.max(data.length - 1, 1);
    const x = 5 + fraction * 590;
    const y = 147 - value.created / (step * 4) * 143;
    line.setAttribute('x1', x); line.setAttribute('x2', x);
    circle.setAttribute('cx', x); circle.setAttribute('cy', y);
    cursor.setAttribute('visibility', 'visible');
    tip.textContent = `${formatDate(value.start)}${value.start === value.end ? '' : ` – ${formatDate(value.end)}`} · ${value.created} abertos · ${value.resolved} resolvidos`;
    tip.hidden = false;
    const available = Math.max(0, plot.clientWidth - tip.offsetWidth);
    tip.style.setProperty('--tooltip-left', `${Math.min(available, Math.max(0, fraction * plot.clientWidth - tip.offsetWidth / 2))}px`);
  };
  const hide = () => { tip.hidden = true; cursor.setAttribute('visibility', 'hidden'); };
  plot.addEventListener('pointermove', event => {
    const rect = plot.getBoundingClientRect();
    show(Math.round((event.clientX - rect.left) / rect.width * (data.length - 1)));
  });
  plot.addEventListener('pointerleave', hide);
  plot.addEventListener('focus', () => show(index));
  plot.addEventListener('blur', hide);
  plot.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    show({ ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: data.length - 1 }[event.key]);
  });
}

export function donut(rows) {
  const compact = { waiting_requester: 'Ag. solicitante', waiting_third_party: 'Ag. terceiro' };
  const order = ['open', 'in_progress', 'waiting_requester', 'resolved', 'triage', 'closed', 'cancelled', 'waiting_third_party'];
  const data = order.map((key, index) => ({ key, index, value: rows.find(row => row.key === key)?.value ?? 0 })).filter(item => item.value);
  const total = data.reduce((sum, item) => sum + item.value, 0);
  let offset = 0;
  const arcs = data.map(({ value, index }) => {
    const portion = 100 * value / total;
    const gap = data.length > 1 ? Math.min(1.5, portion / 3) : 0;
    const arc = `<circle class="donut-segment c${index}" data-segment="${index}" cx="60" cy="60" r="48" pathLength="100" stroke-dasharray="${portion - gap} ${100 - portion + gap}" stroke-dashoffset="${-offset}"/>`;
    offset += portion;
    return arc;
  });
  return `<section class="panel"><div class="panel-head"><div><h2 class="section-title">Chamados por status</h2><p>Distribuição no período selecionado</p></div></div>
    <div class="panel-body donut-layout"><div class="donut"><svg viewBox="0 0 120 120" aria-hidden="true"><circle class="donut-track" cx="60" cy="60" r="48"/>${arcs.join('')}</svg>
      <div class="donut-center"><strong data-donut-total>${number(total)}</strong><span data-donut-label>Chamados</span></div></div>
    ${total ? `<ul class="chart-legend">${data.map(({ key, value, index }) => `<li><a class="legend-item c${index}" href="#/tickets?status=${key}" data-index="${index}" data-value="${value}" title="${esc(statusLabels[key])}"><i></i>${esc(compact[key] ?? statusLabels[key])}<strong>${number(value)}</strong></a></li>`).join('')}</ul>` : '<p class="muted small">Nenhum chamado no período.</p>'}</div></section>`;
}

export function activateDonut(root) {
  const amount = root.querySelector('[data-donut-total]');
  if (!amount) return;
  const label = root.querySelector('[data-donut-label]');
  const total = amount.textContent;
  for (const item of root.querySelectorAll('.legend-item')) {
    const arc = root.querySelector(`[data-segment="${item.dataset.index}"]`);
    const show = () => { arc.classList.add('highlight'); amount.textContent = number(Number(item.dataset.value)); label.textContent = 'No status'; };
    const hide = () => { arc.classList.remove('highlight'); amount.textContent = total; label.textContent = 'Chamados'; };
    item.addEventListener('mouseenter', show); item.addEventListener('focus', show);
    item.addEventListener('mouseleave', hide); item.addEventListener('blur', hide);
  }
}

export function bars(items, emptyMessage = 'Sem dados no período.') {
  if (!items.length) return `<p class="muted small">${esc(emptyMessage)}</p>`;
  const max = Math.max(1, ...items.map(item => item.value));
  return `<div class="bar-list">${items.map(({ label, value, color = 0, title = label }) => `<div class="c${color}" title="${esc(title)}"><div class="bar-label"><span class="truncate">${esc(label)}</span><strong>${number(value)}</strong></div><progress value="${value}" max="${max}" aria-label="${esc(label)}"></progress></div>`).join('')}</div>`;
}

export function priorityBars(data) {
  return bars(['critical', 'high', 'medium', 'low'].map((key, index) => ({ label: priorityLabels[key], value: data.find(item => item.key === key)?.value ?? 0, color: [6, 2, 1, 5][index] })));
}

export function slaSummary({ met, breached }) {
  const percent = met + breached ? Math.round(100 * met / (met + breached)) : null;
  return `<div class="sla-summary"><strong>${percent === null ? '—' : `${percent}%`}</strong><progress class="c3" value="${percent ?? 0}" max="100" aria-label="Cumprimento do SLA"></progress>
    <div class="chart-key"><span class="series-green"><i></i>${number(met)} cumpridos</span><span>${number(breached)} violações</span></div></div>`;
}

const metrics = [
  ['total', 'Total de chamados', 'ticket', 'purple'], ['open', 'Chamados abertos', 'inbox', 'blue'], ['in_progress', 'Em andamento', 'play', 'purple'], ['resolved', 'Resolvidos', 'checkCircle', 'green'],
  ['pending', 'Chamados pendentes', 'pause', 'amber'], ['critical', 'Chamados críticos', 'bolt', 'red'], ['warning', 'SLA a vencer', 'timer', 'amber'], ['breached', 'SLA violado', 'alert', 'red']
];

function delta(value, previous, direction = 0) {
  if (!previous) return '<span>Sem base de comparação</span>';
  const ratio = Math.round(100 * (value - previous) / previous);
  const tone = ratio === 0 || direction === 0 ? '' : Math.sign(ratio) === direction ? 'good' : 'bad';
  return `<span class="change ${tone}">${icon(ratio > 0 ? 'upRight' : ratio < 0 ? 'downRight' : 'minus')}${ratio > 0 ? '+' : ''}${number(ratio)}%</span><span>vs. período anterior</span>`;
}

export function metricCards(current, previous) {
  return `<div class="metric-grid">${metrics.map(([key, label, glyph, tone], index) => {
    const direction = key === 'resolved' ? 1 : ['critical', 'warning', 'breached'].includes(key) ? -1 : 0;
    const variation = index < 4 || previous[key] ? `<div class="metric-foot">${delta(current[key], previous[key], direction)}</div>` : '';
    return `<article class="panel metric${index >= 4 ? ' minor' : ''}"><div class="metric-label">${label}</div><div class="metric-icon tone-${tone}">${icon(glyph)}</div><strong class="metric-value numeric">${number(current[key])}</strong>${variation}</article>`;
  }).join('')}</div>`;
}

export function reportCards(data) {
  const { indicators, sla } = data;
  const percent = sla.met + sla.breached ? `${Math.round(100 * sla.met / (sla.met + sla.breached))}%` : '—';
  const cards = [['Chamados', number(indicators.total), 'ticket', 'purple'], ['Tempo médio de atendimento', indicators.avg_response === null ? '—' : duration(indicators.avg_response), 'clock', 'blue'],
    ['Tempo médio de resolução', indicators.avg_resolution === null ? '—' : duration(indicators.avg_resolution), 'checkCircle', 'green'], ['SLA cumprido', percent, 'shield', 'green']];
  return `<div class="metric-grid">${cards.map(([label, value, glyph, tone]) => `<article class="panel metric minor"><div class="metric-label">${label}</div><div class="metric-icon tone-${tone}">${icon(glyph)}</div><strong class="metric-value numeric">${value}</strong></article>`).join('')}</div>`;
}
