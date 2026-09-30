// Monthly usage summary a Tens pla? operator can send to a widget client. Plain text so it can be
// pasted into an email; no visitor data exists to report beyond aggregated loads per domain.

const TEXT = {
  ca: {
    locale: 'ca-ES',
    title: 'Informe d’ús de l’agenda Tens pla?',
    widget: 'Agenda',
    period: 'Període',
    territory: 'Territori',
    layout: { list: 'llista', grid: 'graella', compact: 'compacte' },
    languages: { ca: 'català', es: 'castellà' },
    format: 'Format',
    language: 'Idioma',
    near: (place, km) => `${place} i voltants (${km} km)`,
    loads: 'Càrregues de l’agenda',
    byDomain: 'Per web',
    average: 'Mitjana diària',
    topDays: 'Dies amb més càrregues',
    unknownOrigin: 'web sense identificar',
    none: 'No s’ha registrat cap càrrega en aquest període.',
    rejected: (count) => `Intents bloquejats des d’altres webs: ${count}`,
    note: 'Una càrrega és cada vegada que una pàgina mostra l’agenda. No es recullen dades dels visitants.',
  },
  es: {
    locale: 'es-ES',
    title: 'Informe de uso de la agenda Tens pla?',
    widget: 'Agenda',
    period: 'Periodo',
    territory: 'Territorio',
    layout: { list: 'lista', grid: 'cuadrícula', compact: 'compacto' },
    languages: { ca: 'catalán', es: 'castellano' },
    format: 'Formato',
    language: 'Idioma',
    near: (place, km) => `${place} y alrededores (${km} km)`,
    loads: 'Cargas de la agenda',
    byDomain: 'Por web',
    average: 'Media diaria',
    topDays: 'Días con más cargas',
    unknownOrigin: 'web sin identificar',
    none: 'No se ha registrado ninguna carga en este periodo.',
    rejected: (count) => `Intentos bloqueados desde otras webs: ${count}`,
    note: 'Una carga es cada vez que una página muestra la agenda. No se recogen datos de los visitantes.',
  },
};

export function monthRange(month) {
  const match = /^(\d{4})-(\d{2})$/.exec(month ?? '');
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) {
    throw new Error('--month ha de tenir el format AAAA-MM.');
  }
  const [year, monthNumber] = [Number(match[1]), Number(match[2])];
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, '0')}`, days: lastDay };
}

// The month before the given civil date (YYYY-MM-DD), e.g. 2026-10-02 -> 2026-09.
export function previousMonth(isoDate) {
  const [year, month] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 2, 1));
  return date.toISOString().slice(0, 7);
}

function describeTerritory(territory, t) {
  if (territory.near) return t.near(territory.municipality, String(territory.near.radiusKm).replace('.', ','));
  return territory.municipality || territory.comarca || territory.province;
}

export function buildUsageReport({ widget, rows, month, language = widget.config.language }) {
  const t = TEXT[language] || TEXT.ca;
  const { from, to, days } = monthRange(month);
  const number = new Intl.NumberFormat(t.locale);
  const periodFormat = new Intl.DateTimeFormat(t.locale, { timeZone: 'UTC', month: 'long', year: 'numeric' });
  const dayFormat = new Intl.DateTimeFormat(t.locale, { timeZone: 'UTC', day: '2-digit', month: '2-digit' });
  const inPeriod = rows.filter(({ usageDate }) => usageDate >= from && usageDate <= to);

  const byOrigin = new Map();
  const byDay = new Map();
  let total = 0;
  let rejected = 0;
  for (const row of inPeriod) {
    rejected += row.rejected;
    if (!row.impressions) continue;
    total += row.impressions;
    byOrigin.set(row.origin, (byOrigin.get(row.origin) || 0) + row.impressions);
    byDay.set(row.usageDate, (byDay.get(row.usageDate) || 0) + row.impressions);
  }

  const lines = [
    t.title,
    '',
    `${t.widget}: ${widget.name}${widget.clientName ? ` (${widget.clientName})` : ''}`,
    `${t.period}: ${periodFormat.format(new Date(`${from}T00:00:00Z`))}`,
    `${t.territory}: ${describeTerritory(widget.config.territory, t)}`,
    `${t.format}: ${t.layout[widget.config.layout]} · ${t.language}: ${t.languages[widget.config.language]}`,
    '',
  ];
  if (!total) {
    lines.push(t.none);
  } else {
    lines.push(`${t.loads}: ${number.format(total)}`);
    lines.push(`${t.average}: ${number.format(Math.round(total / days))}`);
    lines.push('', `${t.byDomain}:`);
    for (const [origin, count] of [...byOrigin].sort((a, b) => b[1] - a[1])) {
      const label = origin === 'unknown' ? t.unknownOrigin : origin.replace(/^https?:\/\//, '');
      lines.push(`  ${label}: ${number.format(count)}`);
    }
    const topDays = [...byDay].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3)
      .map(([date, count]) => `${dayFormat.format(new Date(`${date}T00:00:00Z`))} (${number.format(count)})`);
    lines.push('', `${t.topDays}: ${topDays.join(', ')}`);
  }
  if (rejected) lines.push('', t.rejected(number.format(rejected)));
  lines.push('', t.note);
  return lines.join('\n');
}
