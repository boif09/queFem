import { createHash } from 'node:crypto';

export const FEVER_TIMEZONE = 'Europe/Madrid';

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_MINUTE = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/;
const EXPLICIT_INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:?\d{2})$/i;

const LOCAL_PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: FEVER_TIMEZONE,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

function validDate(year, month, day) {
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
  return date.getUTCFullYear() === Number(year)
    && date.getUTCMonth() === Number(month) - 1
    && date.getUTCDate() === Number(day);
}

function validTime(hour, minute, second = '00') {
  return Number(hour) >= 0 && Number(hour) <= 23
    && Number(minute) >= 0 && Number(minute) <= 59
    && Number(second) >= 0 && Number(second) <= 59;
}

function occurrenceKey(localDate, localTime, startsAt) {
  const canonicalIdentity = startsAt
    ? `instant|${startsAt}`
    : `${FEVER_TIMEZONE}|${localDate}|${localTime || 'date-only'}`;
  const digest = createHash('sha256').update(canonicalIdentity).digest('hex').slice(0, 24);
  return `fever-session:${digest}`;
}

function occurrence(localDate, localTime, startsAt) {
  return {
    occurrenceKey: occurrenceKey(localDate, localTime, startsAt),
    startsAt,
    endsAt: null,
    localDate,
    localTime,
    timezone: FEVER_TIMEZONE,
  };
}

function localParts(instant, includeSeconds) {
  const parts = Object.fromEntries(LOCAL_PARTS.formatToParts(instant)
    .filter(({ type }) => ['year', 'month', 'day', 'hour', 'minute', 'second'].includes(type))
    .map(({ type, value }) => [type, value]));
  return {
    localDate: `${parts.year}-${parts.month}-${parts.day}`,
    localTime: includeSeconds
      ? `${parts.hour}:${parts.minute}:${parts.second}`
      : `${parts.hour}:${parts.minute}`,
  };
}

export function parseFeverSessionToken(value) {
  if (typeof value !== 'string' || !value.trim()) return { valid: false, reason: 'empty session token' };
  const token = value.trim();
  let match = DATE_ONLY.exec(token);
  if (match) {
    if (!validDate(match[1], match[2], match[3])) return { valid: false, reason: 'invalid calendar date', token };
    const localDate = `${match[1]}-${match[2]}-${match[3]}`;
    return { valid: true, format: 'date-only', occurrence: occurrence(localDate, null, null), token };
  }

  match = LOCAL_MINUTE.exec(token);
  if (match) {
    if (!validDate(match[1], match[2], match[3])) return { valid: false, reason: 'invalid calendar date', token };
    if (!validTime(match[4], match[5])) return { valid: false, reason: 'invalid local time', token };
    const localDate = `${match[1]}-${match[2]}-${match[3]}`;
    const localTime = `${match[4]}:${match[5]}`;
    return { valid: true, format: 'local-minute', occurrence: occurrence(localDate, localTime, null), token };
  }

  match = EXPLICIT_INSTANT.exec(token);
  if (match) {
    if (!validDate(match[1], match[2], match[3])) return { valid: false, reason: 'invalid calendar date', token };
    if (!validTime(match[4], match[5], match[6])) return { valid: false, reason: 'invalid time', token };
    const normalizedOffset = match[7].toUpperCase() === 'Z'
      ? 'Z'
      : match[7].replace(/^([+-]\d{2})(\d{2})$/, '$1:$2');
    const seconds = match[6] ? `:${match[6]}` : '';
    const canonicalInstant = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}${seconds}${normalizedOffset}`;
    const instant = new Date(canonicalInstant);
    if (Number.isNaN(instant.valueOf())) return { valid: false, reason: 'invalid explicit instant', token };
    const local = localParts(instant, Boolean(match[6]));
    return {
      valid: true,
      format: normalizedOffset === 'Z' ? 'explicit-z' : 'explicit-offset',
      occurrence: occurrence(local.localDate, local.localTime, instant.toISOString()),
      token,
    };
  }

  return { valid: false, reason: 'unknown session format', token };
}

function manufacturerTokens(value) {
  if (Array.isArray(value)) return value.map((entry) => String(entry ?? ''));
  if (typeof value === 'string') return value.split(',');
  if (value === null || value === undefined) return [];
  return [String(value)];
}

export function parseFeverManufacturer(value) {
  const rawTokens = manufacturerTokens(value);
  const occurrences = [];
  const anomalies = [];
  const keys = new Set();
  const formats = { localMinute: 0, dateOnly: 0, explicitOffset: 0, explicitZ: 0 };
  let invalid = 0;
  let duplicates = 0;
  let empty = 0;

  for (const rawToken of rawTokens) {
    const parsed = parseFeverSessionToken(rawToken);
    if (!parsed.valid) {
      if (parsed.reason === 'empty session token') empty += 1;
      else invalid += 1;
      anomalies.push({ reason: parsed.reason, value: parsed.token || '' });
      continue;
    }
    const formatKey = {
      'local-minute': 'localMinute', 'date-only': 'dateOnly',
      'explicit-offset': 'explicitOffset', 'explicit-z': 'explicitZ',
    }[parsed.format];
    formats[formatKey] += 1;
    if (keys.has(parsed.occurrence.occurrenceKey)) {
      duplicates += 1;
      anomalies.push({ reason: 'duplicate canonical session', value: parsed.token });
      continue;
    }
    keys.add(parsed.occurrence.occurrenceKey);
    occurrences.push(parsed.occurrence);
  }

  return {
    occurrences,
    anomalies,
    statistics: {
      tokens: rawTokens.filter((token) => token.trim()).length,
      parsed: occurrences.length,
      invalid,
      duplicates,
      empty,
      formats,
    },
  };
}
