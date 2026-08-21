export const LOCATION_PREFERENCE_KEY = 'quefem.location';

const LOCATION_KEYS = ['province', 'comarca', 'municipality'];

function sanitizeLocation(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(LOCATION_KEYS.flatMap((key) => {
    const item = value[key];
    return typeof item === 'string' && item.trim() ? [[key, item.trim()]] : [];
  }));
}

function getStorage(storage) {
  if (storage) return storage;
  try { return globalThis.localStorage; } catch { return null; }
}

export function readLocationPreference(storage) {
  try {
    const saved = JSON.parse(getStorage(storage)?.getItem(LOCATION_PREFERENCE_KEY) || 'null');
    if (saved?.version !== 1) return {};
    return sanitizeLocation(saved.location);
  } catch { return {}; }
}

export function saveLocationPreference(location, storage) {
  const target = getStorage(storage);
  const clean = sanitizeLocation(location);
  try {
    if (Object.keys(clean).length === 0) target?.removeItem(LOCATION_PREFERENCE_KEY);
    else target?.setItem(LOCATION_PREFERENCE_KEY, JSON.stringify({ version: 1, location: clean }));
  } catch { /* Storage can be unavailable or blocked. */ }
  return clean;
}

export function clearLocationPreference(storage) {
  try { getStorage(storage)?.removeItem(LOCATION_PREFERENCE_KEY); } catch { /* Storage can be unavailable or blocked. */ }
}

export function formatLocationPreference(location) {
  return ['municipality', 'comarca', 'province'].map((key) => location?.[key]).filter(Boolean).join(' · ');
}
