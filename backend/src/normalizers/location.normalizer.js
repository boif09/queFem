function humanizeSlug(slug) {
  if (!slug) return null;

  let decoded = slug;
  try {
    decoded = decodeURIComponent(slug);
  } catch {
    // The original source value is retained in source_payload_json.
  }

  const words = decoded.split('-').filter(Boolean);
  const label = words.map((word, index) => {
    const lower = word.toLocaleLowerCase('ca');
    if (index > 0 && ['de', 'del', 'dels', 'i', 'la', 'les'].includes(lower)) return lower;
    return lower.charAt(0).toLocaleUpperCase('ca') + lower.slice(1);
  }).join(' ');

  return label
    .replace(/\b([DL]) ([AEIOUH])/g, "$1'$2")
    .replace(/\s+/g, ' ')
    .trim() || null;
}

function parseLocationTag(value) {
  if (typeof value !== 'string') return [];
  const marker = 'agenda:ubicacions/';
  const start = value.indexOf(marker);
  if (start === -1) return [];
  return value.slice(start + marker.length).split('/').filter(Boolean);
}

export function normalizeLocation(record) {
  const locationParts = parseLocationTag(record.municipi || record.comarca_i_municipi);
  const comarcaParts = parseLocationTag(record.comarca);
  const provinceSlug = locationParts[0] || comarcaParts[0];
  const comarcaSlug = locationParts[1] || comarcaParts[1];
  const municipalitySlug = locationParts[2];

  return {
    province: humanizeSlug(provinceSlug),
    comarca: humanizeSlug(comarcaSlug),
    municipality: humanizeSlug(municipalitySlug),
    locality: humanizeSlug(record.localitat) || null,
  };
}
