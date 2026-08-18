const IMAGE_FIELDS = new Set(['eventImageUrl', 'images', 'image', 'imageUrl']);

export function parseDiscoveryFeed(payload) {
  const records = Array.isArray(payload) ? payload : payload?.events;
  if (!Array.isArray(records)) {
    throw new Error('El Discovery Feed no conté una llista completa d’esdeveniments.');
  }
  if (records.length === 0) {
    throw new Error('El Discovery Feed és buit i no es pot considerar complet.');
  }
  if (records.some((record) => !record || typeof record !== 'object' || Array.isArray(record))) {
    throw new Error('El Discovery Feed conté registres amb una estructura invàlida.');
  }
  return records;
}

export function withoutRestrictedImages(value) {
  if (Array.isArray(value)) return value.map(withoutRestrictedImages);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !IMAGE_FIELDS.has(key))
    .map(([key, child]) => [key, withoutRestrictedImages(child)]));
}
