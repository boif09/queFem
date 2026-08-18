const ACCEPTED_SOURCES = new Set(['trium', 'mfx-es']);

export function isAcceptedTicketmasterSource(event) {
  return ACCEPTED_SOURCES.has(event?.source)
    && event?.brandName === 'Ticketmaster'
    && event?.officialSeller === true;
}

export function ticketmasterSourceBucket(event) {
  if (isAcceptedTicketmasterSource(event)) return event.source;
  if (event?.source === 'universe') return 'universe';
  if (event?.source === 'mfx-external') return 'mfx-external';
  return 'other';
}

