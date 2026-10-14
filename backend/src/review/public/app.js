'use strict';

const token = document.querySelector('meta[name="review-token"]').content;
const main = document.getElementById('main');
const tabsBox = document.getElementById('tabs');
const summary = document.getElementById('summary');
const toast = document.getElementById('toast');
const KIND_LABEL = {
  POSSIBLE_DUPLICATE_OF_PUBLISHED_PLAN: 'Posible duplicado de un plan ya publicado',
  POSSIBLE_DUPLICATE_WITHIN_FEED: 'Posible duplicado dentro de DIBA',
};
const SOURCE_LABEL = { 'gencat-agenda': 'Gencat', 'diba-escenari': 'DIBA Escenari', 'diba-tourisme': 'DIBA Turisme', 'diba-museus': 'DIBA Museus', fever: 'Fever', 'ticketmaster-discovery-feed': 'Ticketmaster' };
let data = null;
let filter = 'all';
let toastTimer = null;

// All text from the queue comes from external feeds: only textContent is ever used, never innerHTML.
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) if (child) node.append(child);
  return node;
}

const norm = (value) => String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const dates = (row) => (row.startDate ? (row.endDate && row.endDate !== row.startDate ? `${row.startDate} → ${row.endDate}` : row.startDate) : 'sin fecha');

function showToast(message, isError = false) {
  toast.textContent = message;
  toast.className = isError ? 'toast error' : 'toast';
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 5000);
}

async function call(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', 'X-Review-Token': token },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = body.problems && body.problems.length ? ` (${body.problems.join('; ')})` : '';
    throw new Error(`${body.error || `Error ${response.status}`}${detail}`);
  }
  return body;
}

// A normalised view of one side of a comparison: either a DIBA record (with its plan) or a published plan.
function side(label, source) {
  return {
    label,
    title: source.title,
    startDate: source.startDate, endDate: source.endDate,
    municipality: source.municipality, venue: source.venue, address: source.address, schedule: source.schedule, startsAt: source.startsAt,
    planId: source.planId ?? source.id ?? null,
    sources: source.sources ?? [], url: source.url ?? null, status: source.status ?? null,
  };
}

function itemSides(item) {
  if (item.kind === 'POSSIBLE_DUPLICATE_OF_PUBLISHED_PLAN') {
    const record = item.records[0];
    const published = item.candidatePlans[0];
    return [
      side('Registro DIBA', { ...record, ...(record.plan || {}), title: record.plan?.title ?? record.title, url: record.plan?.url ?? record.sourceUrl, planId: record.planId }),
      side('Plan publicado', published || {}),
    ];
  }
  return item.records.map((record, index) => side(`Registro DIBA ${index === 0 ? 'A' : 'B'}`, {
    ...record, ...(record.plan || {}), title: record.plan?.title ?? record.title, url: record.plan?.url ?? record.sourceUrl, planId: record.planId,
  }));
}

function renderSide(entry, other) {
  const diffs = {
    municipality: norm(entry.municipality) !== norm(other?.municipality),
    venue: norm(entry.venue) !== norm(other?.venue),
    schedule: norm(entry.schedule) !== norm(other?.schedule),
    startsAt: Boolean(entry.startsAt && other?.startsAt) && entry.startsAt !== other.startsAt,
  };
  return el('div', { class: 'col' },
    el('span', { class: 'label', text: entry.label }),
    el('span', { class: 'title', text: entry.title || '(sin título)' }),
    el('span', { class: `line${entry.startDate !== other?.startDate || entry.endDate !== other?.endDate ? ' diff' : ''}`, text: dates(entry) }),
    el('span', { class: `line${diffs.municipality ? ' diff' : ''}`, text: entry.municipality || 'municipio desconocido' }),
    el('span', { class: `line${diffs.venue ? ' diff' : ''}`, text: [entry.venue, entry.address].filter(Boolean).join(' · ') || 'lugar desconocido' }),
    entry.startsAt ? el('span', { class: `line${diffs.startsAt ? ' diff' : ''}`, text: `Inicio: ${entry.startsAt.slice(0, 16)}` }) : null,
    el('span', { class: `line${diffs.schedule ? ' diff' : ''}`, text: `Horario: ${entry.schedule || 'sin indicar'}` }),
    el('div', { class: 'chips' },
      entry.planId ? el('span', { class: 'chip', text: `plan ${entry.planId}` }) : el('span', { class: 'chip', text: 'sin plan' }),
      ...entry.sources.map((key) => el('span', { class: 'chip', text: SOURCE_LABEL[key] || key })),
      entry.status && entry.status !== 'active' ? el('span', { class: 'chip', text: entry.status }) : null),
    entry.url ? el('a', { href: entry.url, target: '_blank', rel: 'noopener noreferrer', text: 'Abrir ficha' }) : null);
}

function matchLine(left, right) {
  const checks = [
    ['título', norm(left.title) === norm(right.title)],
    ['fechas', left.startDate === right.startDate && left.endDate === right.endDate],
    ['municipio', norm(left.municipality) === norm(right.municipality)],
    ['lugar', norm(left.venue) === norm(right.venue)],
    ['horario', norm(left.schedule) === norm(right.schedule)],
    ...(left.startsAt && right.startsAt ? [['hora de inicio', left.startsAt === right.startsAt]] : []),
  ];
  return el('div', { class: 'match' }, checks.map(([name, same]) => el('span', { class: same ? 'ok' : 'no', text: `${same ? '✓' : '✗'} ${name}` })));
}

function setBusy(card, busy) {
  for (const button of card.querySelectorAll('button')) button.disabled = busy;
}

function renderCard(item) {
  const [left, right] = itemSides(item);
  const card = el('article', { class: 'card', 'data-id': item.id });
  const actions = el('div', { class: 'actions' });
  const confirmBox = el('div', { class: 'confirm', hidden: true });

  const run = async (path, success) => {
    setBusy(card, true);
    try {
      const result = await call(path, { method: 'POST', body: '{}' });
      showToast(success(result));
      await load();
    } catch (error) {
      showToast(error.message, true);
      setBusy(card, false);
    }
  };

  const ask = (text, confirmLabel, handler) => {
    confirmBox.replaceChildren(
      el('span', { text }),
      el('button', { type: 'button', class: 'btn primary', text: confirmLabel, onclick: handler }),
      el('button', { type: 'button', class: 'btn ghost', text: 'Cancelar', onclick: () => { confirmBox.hidden = true; actions.hidden = false; } }));
    confirmBox.hidden = false;
    actions.hidden = true;
  };

  const merge = item.actions.merge;
  const mergeButton = el('button', {
    type: 'button', class: 'btn primary', text: 'Importar (fusionar)', disabled: !merge.available,
    onclick: () => ask('Se unirá en un solo plan; el otro redirigirá al plan que se conserva.', 'Sí, fusionar',
      () => run(`/api/items/${item.id}/merge`, (result) => `Fusionado en el plan ${result.canonicalPlanId}.`)),
  });
  actions.append(mergeButton,
    el('button', {
      type: 'button', class: 'btn', text: 'Mantener separado',
      onclick: () => ask('Se publicarán como planes distintos y este caso dejará de aparecer.', 'Sí, mantener separado',
        () => run(`/api/items/${item.id}/keep-separate`, () => 'Marcado como distinto.')),
    }));
  if (!merge.available && merge.problems.length) actions.append(el('span', { class: 'hint', text: `No se puede fusionar: ${merge.problems.join(' · ')}` }));

  card.append(
    el('div', { class: 'card-head' },
      el('h2', { text: left.title || right?.title || 'Caso' }),
      el('span', { class: 'badge', text: KIND_LABEL[item.kind] || item.kind })),
    right ? matchLine(left, right) : null,
    el('div', { class: 'cols' }, renderSide(left, right), right ? renderSide(right, left) : null),
    actions, confirmBox);
  return card;
}

function section(title, children) {
  return el('section', { class: 'group' }, el('h3', { text: title }), el('ul', { class: 'list' }, children));
}

function renderLists() {
  const blocks = [];
  if (data.recent.length) {
    blocks.push(section('Decisiones recientes', data.recent.map((row) => {
      const label = row.decision === 'MERGED' ? `Fusionado en el plan ${row.canonicalPlanId}${row.title ? ` («${row.title}»)` : ''}` : 'Mantenido separado';
      const undo = row.decision === 'KEEP_SEPARATE'
        ? el('button', {
          type: 'button', class: 'btn ghost', text: 'Deshacer',
          onclick: async () => {
            try { await call(`/api/items/${row.itemId}/undo`, { method: 'POST', body: '{}' }); showToast('Decisión deshecha: el caso volverá a la cola.'); await load(); }
            catch (error) { showToast(error.message, true); }
          },
        }) : null;
      return el('li', {}, `${row.decidedAt.slice(0, 16).replace('T', ' ')} · ${label} · ${row.sourceRecordId} `, undo);
    })));
  }
  if (data.stale.length) {
    blocks.push(section('Decisiones antiguas con destino perdido (solo informativo)', data.stale.map((row) => el('li', {},
      `${row.records.map((record) => record.sourceRecordId).join(', ')} → ${row.staleTarget ? `${row.staleTarget.sourceKey}:${row.staleTarget.sourceRecordId}` : '?'}. `
      + 'Se ignoran en la importación; hay que retirarlas de data-policy/ en Git.'))));
  }
  return blocks;
}

function render() {
  const counts = { all: data.items.length };
  for (const item of data.items) counts[item.kind] = (counts[item.kind] || 0) + 1;
  summary.textContent = data.items.length
    ? `${data.items.length} casos pendientes · cola actualizada ${data.queueUpdatedAt ? data.queueUpdatedAt.slice(0, 16).replace('T', ' ') : 'nunca'}`
    : 'No hay casos pendientes.';
  const tabs = [['all', 'Todos'], ['POSSIBLE_DUPLICATE_OF_PUBLISHED_PLAN', 'Con un plan publicado'], ['POSSIBLE_DUPLICATE_WITHIN_FEED', 'Dentro de DIBA']];
  tabsBox.replaceChildren(...tabs.map(([key, label]) => el('button', {
    type: 'button', class: 'tab', 'aria-pressed': String(filter === key), text: `${label} (${counts[key] || 0})`,
    onclick: () => { filter = key; render(); },
  })));
  const visible = data.items.filter((item) => filter === 'all' || item.kind === filter);
  main.replaceChildren(
    ...(visible.length ? visible.map(renderCard) : [el('p', { class: 'empty', text: data.items.length ? 'No hay casos en este filtro.' : 'Todo revisado. La cola se actualiza con cada importación de DIBA.' })]),
    ...renderLists());
}

async function load() {
  try {
    data = await call('/api/items');
    render();
  } catch (error) {
    main.replaceChildren(el('p', { class: 'empty', text: `No se pudo cargar la cola: ${error.message}` }));
  }
}

document.getElementById('reload').addEventListener('click', load);
load();
