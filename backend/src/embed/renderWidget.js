import crypto from 'node:crypto';

const STRINGS = {
  ca: {
    weekdays: ['dg.', 'dl.', 'dt.', 'dc.', 'dj.', 'dv.', 'ds.'],
    months: ['gen.', 'febr.', 'març', 'abr.', 'maig', 'juny', 'jul.', 'ag.', 'set.', 'oct.', 'nov.', 'des.'],
    heading: (place) => `Plans · ${place}`,
    headingNear: (place) => `Plans · ${place} i voltants`,
    distance: (km) => `a ${String(km).replace('.', ',')} km`,
    until: 'Fins al', free: 'Gratuït', now: 'Ara', ongoing: 'en curs', always: 'Sempre', open: 'obert',
    sections: { upcoming: 'Propers dies', permanent: 'Per visitar' },
    empty: 'Ara mateix no hi ha plans publicats per a aquesta zona.',
    more: 'Veure tots els plans', by: 'Agenda de', data: 'Dades:',
    updated: (date) => `Dades actualitzades el ${date}`,
    unavailable: 'Aquesta agenda no està disponible ara mateix.',
    label: 'Agenda de plans de Tens pla?',
  },
  es: {
    weekdays: ['dom.', 'lun.', 'mar.', 'mié.', 'jue.', 'vie.', 'sáb.'],
    months: ['ene.', 'feb.', 'mar.', 'abr.', 'may.', 'jun.', 'jul.', 'ago.', 'sept.', 'oct.', 'nov.', 'dic.'],
    heading: (place) => `Planes · ${place}`,
    headingNear: (place) => `Planes · ${place} y alrededores`,
    distance: (km) => `a ${String(km).replace('.', ',')} km`,
    until: 'Hasta el', free: 'Gratis', now: 'Ahora', ongoing: 'en curso', always: 'Siempre', open: 'abierto',
    sections: { upcoming: 'Próximos días', permanent: 'Para visitar' },
    empty: 'Ahora mismo no hay planes publicados para esta zona.',
    more: 'Ver todos los planes', by: 'Agenda de', data: 'Datos:',
    updated: (date) => `Datos actualizados el ${date}`,
    unavailable: 'Esta agenda no está disponible en este momento.',
    label: 'Agenda de planes de Tens pla?',
  },
};

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ESCAPES[character]);
}

function parseDate(isoDate) {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function textOnAccent(hex) {
  const value = Number.parseInt(hex.slice(1), 16);
  const luminance = 0.299 * (value >> 16) + 0.587 * ((value >> 8) & 255) + 0.114 * (value & 255);
  return luminance > 170 ? '#1a1a1a' : '#ffffff';
}

function formatUpdatedAt(isoTimestamp) {
  if (!isoTimestamp) return null;
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('ca-ES', {
    timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(date);
}

function trackedUrl(path, key, extra = {}) {
  const params = new URLSearchParams({ ...extra, utm_source: 'tenspla-widget', utm_medium: 'embed', utm_campaign: key });
  return `${path}?${params}`;
}

function dateBlock(plan, t) {
  if (plan.permanent || !plan.date) {
    return `<span class="d perm" aria-hidden="true"><span class="wd">${t.always}</span><span class="dn">★</span><span class="mo">${t.open}</span></span>`;
  }
  if (plan.ongoing) {
    return `<span class="d" aria-hidden="true"><span class="wd">${t.ongoing}</span><span class="dn now">${t.now}</span><span class="mo">&nbsp;</span></span>`;
  }
  const date = parseDate(plan.date);
  return `<span class="d" aria-hidden="true"><span class="wd">${t.weekdays[date.getUTCDay()]}</span>`
    + `<span class="dn">${date.getUTCDate()}</span><span class="mo">${t.months[date.getUTCMonth()]}</span></span>`;
}

function accessibleDate(plan, t, language) {
  if (plan.permanent || !plan.date) return `${t.always} ${t.open}`;
  if (plan.ongoing) return t.now;
  return new Intl.DateTimeFormat(language === 'es' ? 'es-ES' : 'ca-ES', {
    timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long',
  }).format(parseDate(plan.date));
}

function planItem(plan, { t, key, language }) {
  const chips = [];
  if (plan.free) chips.push(`<span class="chip free">${t.free}</span>`);
  if (plan.endDate && !plan.permanent) {
    const end = parseDate(plan.endDate);
    chips.push(`<span class="chip until">${t.until} ${end.getUTCDate()} ${t.months[end.getUTCMonth()]}</span>`);
  }
  for (const category of plan.categories.slice(0, 2)) chips.push(`<span class="chip">${escapeHtml(category.name)}</span>`);
  const image = plan.image
    ? `<span class="img"><img src="${escapeHtml(plan.image.url)}" alt="${escapeHtml(plan.image.alt)}" loading="lazy" decoding="async"></span>`
    : '<span class="img none"></span>';
  const place = [plan.municipality, plan.venue].filter(Boolean).map(escapeHtml);
  if (plan.distanceKm !== null && plan.distanceKm !== undefined) place.push(escapeHtml(t.distance(plan.distanceKm)));
  return `<li><a class="item" href="${escapeHtml(trackedUrl(`/plans/${plan.id}`, key, { lang: language }))}" target="_blank" rel="noopener">
${image}${dateBlock(plan, t)}<span class="body"><span class="sr">${escapeHtml(accessibleDate(plan, t, language))}. </span><span class="title">${escapeHtml(plan.title)}</span>
<span class="meta">${place.join(' · ')}</span>${chips.length ? `<span class="chips">${chips.join('')}</span>` : ''}</span></a></li>`;
}

const STYLES = `
*{box-sizing:border-box}html,body{margin:0;background:transparent}
body{font-family:"Montserrat Variable",Montserrat,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;-webkit-font-smoothing:antialiased}
.w{--bg:#fff;--ink:#1a1a1a;--muted:#5d6070;--line:rgba(26,26,26,.12);--chip:#f3f1ec;background:var(--bg);color:var(--ink);border:1px solid var(--line);border-radius:12px;overflow:hidden}
.w.dark{--bg:#1c1d22;--ink:#f2efe9;--muted:#a8aab4;--line:rgba(242,239,233,.14);--chip:#2a2c33}
@media (prefers-color-scheme:dark){.w.auto{--bg:#1c1d22;--ink:#f2efe9;--muted:#a8aab4;--line:rgba(242,239,233,.14);--chip:#2a2c33}}
.head{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;gap:4px 12px;padding:16px 18px 10px}
.head h1{margin:0;font-size:17px;font-weight:800;line-height:1.25}
.tabs{display:flex;flex-wrap:wrap;gap:6px;padding:0 18px 12px}
.tab{font-family:inherit;font-size:12px;font-weight:700;padding:6px 12px;border-radius:999px;border:1.5px solid var(--line);background:transparent;color:var(--ink);cursor:pointer}
.tab[aria-selected=true]{background:var(--accent);border-color:var(--accent);color:var(--on-accent)}
.list{list-style:none;margin:0;padding:0 10px 8px;display:grid}
.item{display:grid;grid-template-columns:54px minmax(0,1fr);gap:12px;align-items:start;padding:10px 8px;border-radius:8px;color:inherit;text-decoration:none}
.item:hover{background:var(--chip)}
.item:focus-visible,.tab:focus-visible,.more:focus-visible,.brand:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.list li+li .item{border-top:1px solid var(--line);border-radius:0}
.d{display:grid;justify-items:center;line-height:1;padding:7px 0 6px;border-radius:8px;background:var(--chip);font-variant-numeric:tabular-nums}
.wd,.mo{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em}.wd{color:var(--muted)}
.dn{font-size:21px;font-weight:900;margin:3px 0 2px;color:var(--accent)}.dn.now{font-size:14px;margin:6px 0 4px}.perm .dn{font-size:18px}
.body{display:grid;gap:4px;min-width:0}
.title{font-size:14.5px;font-weight:700;line-height:1.3}
.meta{font-size:12.5px;color:var(--muted);overflow-wrap:anywhere}
.chips{display:flex;flex-wrap:wrap;gap:5px;margin-top:2px}
.chip{font-size:11px;font-weight:600;padding:2px 8px;border-radius:999px;background:var(--chip)}
.chip.free{background:var(--accent);color:var(--on-accent)}.chip.until{background:transparent;border:1px solid var(--line)}
.img{display:none}
.grid .list{grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:14px;padding:0 18px 12px}
.grid .item{grid-template-columns:minmax(0,1fr);padding:0;gap:0;border:1px solid var(--line)!important;border-radius:10px!important;overflow:hidden;position:relative}
.grid .img{display:block;aspect-ratio:16/10;background:var(--chip)}
.grid .img img{width:100%;height:100%;object-fit:cover;display:block}
.grid .d{position:absolute;left:10px;top:10px;width:54px;background:var(--bg);box-shadow:0 2px 10px rgba(0,0,0,.18)}
.grid .body{padding:12px}
.compact .item{grid-template-columns:44px minmax(0,1fr);gap:10px;padding:8px 6px}
.compact .dn{font-size:17px}.compact .chips{display:none}.compact .title{font-size:13.5px}
.empty{margin:0;padding:6px 18px 16px;color:var(--muted);font-size:13.5px}.unavailable{padding-top:16px}
.more{display:block;margin:0 18px 14px;padding:9px 12px;text-align:center;border-radius:8px;border:1.5px solid var(--accent);color:var(--accent);font-size:13px;font-weight:700;text-decoration:none}
.foot{display:grid;gap:4px;padding:11px 18px 13px;border-top:1px solid var(--line);font-size:11px;color:var(--muted)}
.brand{display:inline-flex;align-items:center;gap:6px;color:var(--ink);text-decoration:none;font-weight:600;font-size:12px;justify-self:start}
.logo{font-weight:900;font-size:15px;letter-spacing:-.01em}.logo i{font-style:normal;color:#ff4d3d;display:inline-block;transform:rotate(10deg);margin-left:1px}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
[hidden]{display:none!important}
@media (prefers-reduced-motion:no-preference){.item,.tab{transition:background-color .15s ease,color .15s ease}}
`;

const CLIENT_SCRIPT = `
(function(){
var root=document.querySelector('.w');var key=root.getAttribute('data-key');
var tabs=root.querySelectorAll('.tab');
function select(id){tabs.forEach(function(t){var on=t.getAttribute('data-section')===id;t.setAttribute('aria-selected',String(on));t.tabIndex=on?0:-1;});
root.querySelectorAll('[data-panel]').forEach(function(p){p.hidden=p.getAttribute('data-panel')!==id;});post();}
tabs.forEach(function(t,i){t.addEventListener('click',function(){select(t.getAttribute('data-section'));});
t.addEventListener('keydown',function(e){if(e.key!=='ArrowRight'&&e.key!=='ArrowLeft')return;var n=tabs[(i+(e.key==='ArrowRight'?1:tabs.length-1))%tabs.length];n.focus();select(n.getAttribute('data-section'));});});
if(tabs.length)select(tabs[0].getAttribute('data-section'));
function post(){if(window.parent===window)return;window.parent.postMessage({type:'tenspla:resize',key:key,height:Math.ceil(document.documentElement.getBoundingClientRect().height)},'*');}
if('ResizeObserver' in window)new ResizeObserver(post).observe(document.documentElement);
window.addEventListener('load',post);post();
})();`;

const sha256 = (text) => `'sha256-${crypto.createHash('sha256').update(text, 'utf8').digest('base64')}'`;
const SCRIPT_HASH = sha256(CLIENT_SCRIPT);

// Returns the document plus the CSP hashes of its only inline style and script, so responses can be
// cached without sharing a nonce.
function page({ language, accent = '#0055ff', body }) {
  const style = `${STYLES}.w{--accent:${accent};--on-accent:${textOnAccent(accent)}}`;
  const html = `<!doctype html>
<html lang="${language}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Tens pla?</title>
<style>${style}</style>
</head>
<body>
${body}
<script>${CLIENT_SCRIPT}</script>
</body>
</html>`;
  return { html, styleHash: sha256(style), scriptHash: SCRIPT_HASH };
}

export function renderWidget({ widget, view, language, theme }) {
  const t = STRINGS[language];
  const { config } = widget;
  const place = config.territory.municipality || config.territory.comarca;
  const heading = config.title?.[language]
    || (config.territory.near ? t.headingNear(place) : t.heading(place));
  const key = widget.publicKey;
  const context = { t, key, language };
  const multiple = view.sections.length > 1;

  const tabs = multiple
    ? `<div class="tabs" role="tablist">${view.sections.map(({ id }) => (
      `<button type="button" class="tab" role="tab" id="tab-${id}" aria-controls="panel-${id}" data-section="${id}" aria-selected="false">${t.sections[id]}</button>`
    )).join('')}</div>`
    : '';
  const panels = view.sections.map(({ id, plans }) => {
    const attributes = multiple ? ` id="panel-${id}" role="tabpanel" aria-labelledby="tab-${id}" data-panel="${id}"` : '';
    const content = plans.length
      ? `<ul class="list">${plans.map((plan) => planItem(plan, context)).join('')}</ul>`
      : `<p class="empty">${t.empty}</p>`;
    return `<div${attributes}>${content}</div>`;
  }).join('');

  // A radius has no equivalent filter on tenspla.cat, so its link opens the surrounding comarca.
  const moreFilters = config.territory.municipality && !config.territory.near
    ? { municipality: config.territory.municipality }
    : { comarca: config.territory.comarca };
  if (config.categories.length) moreFilters.category = config.categories.join(',');
  if (config.freeOnly) moreFilters.free = 'true';
  moreFilters.lang = language;
  const updated = formatUpdatedAt(view.updatedAt);

  const body = `<section class="w ${config.layout} ${theme}" data-key="${escapeHtml(key)}" aria-label="${escapeHtml(t.label)}">
<div class="head"><h1>${escapeHtml(heading)}</h1></div>
${tabs}${panels}
<a class="more" href="${escapeHtml(trackedUrl('/plans', key, moreFilters))}" target="_blank" rel="noopener">${t.more} →</a>
<footer class="foot">
<a class="brand" href="${escapeHtml(trackedUrl('/', key, { lang: language }))}" target="_blank" rel="noopener">${t.by} <span class="logo">Tens pla<i>?</i></span></a>
<span>${t.data} ${view.attributions.map(escapeHtml).join(' · ')}</span>
${updated ? `<span>${escapeHtml(t.updated(updated))}</span>` : ''}
</footer>
</section>`;
  return page({ language, accent: config.accent, body });
}

export function renderUnavailable({ language }) {
  const t = STRINGS[language] || STRINGS.ca;
  const body = `<section class="w light" data-key="" aria-label="${escapeHtml(t.label)}">
<p class="empty unavailable">${t.unavailable}</p>
<footer class="foot"><a class="brand" href="/" target="_blank" rel="noopener">${t.by} <span class="logo">Tens pla<i>?</i></span></a></footer>
</section>`;
  return page({ language: STRINGS[language] ? language : 'ca', body });
}
