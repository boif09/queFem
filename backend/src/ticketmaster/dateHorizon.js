function isoDateInCatalonia(now) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

export function horizonBounds(now, lookaheadDays) {
  const today = isoDateInCatalonia(now);
  const end = new Date(`${today}T12:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + lookaheadDays);
  return { today, horizonEnd: end.toISOString().slice(0, 10) };
}

export function classifyDateHorizon(record, bounds) {
  const startDate = validDate(record.eventStartLocalDate);
  const endDate = validDate(record.eventEndLocalDate) || startDate;
  if (!startDate || !endDate || endDate < startDate) return { accepted: false, invalid: true };
  return {
    accepted: endDate >= bounds.today && startDate <= bounds.horizonEnd,
    invalid: false,
    startDate,
    endDate,
  };
}

