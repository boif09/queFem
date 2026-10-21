import { useCallback, useSyncExternalStore } from 'react';

export const FAVORITES_KEY = 'quefem.favorites';
export const MAX_FAVORITES = 200;
const CHANGE_EVENT = 'quefem:favorites';
const MAX_TITLE_LENGTH = 200;

function getStorage(storage) {
  if (storage) return storage;
  try { return globalThis.localStorage; } catch { return null; }
}

function sanitizeItem(item) {
  if (!item || typeof item !== 'object') return null;
  const id = typeof item.id === 'string' || typeof item.id === 'number' ? String(item.id).trim() : '';
  if (!id || id.length > 100) return null;
  const title = typeof item.title === 'string' ? item.title.trim().slice(0, MAX_TITLE_LENGTH) : '';
  const savedAt = typeof item.savedAt === 'string' && !Number.isNaN(Date.parse(item.savedAt)) ? item.savedAt : null;
  return { id, title, savedAt };
}

// Only the plan id, its title (to name a plan that is no longer published) and when it was saved.
export function readFavorites(storage) {
  try {
    const saved = JSON.parse(getStorage(storage)?.getItem(FAVORITES_KEY) || 'null');
    if (saved?.version !== 1 || !Array.isArray(saved.items)) return [];
    const seen = new Set();
    return saved.items.map(sanitizeItem).filter((item) => item && !seen.has(item.id) && seen.add(item.id)).slice(0, MAX_FAVORITES);
  } catch { return []; }
}

function notify() {
  try { globalThis.dispatchEvent?.(new Event(CHANGE_EVENT)); } catch { /* Nothing listens outside a browser. */ }
}

// Returns whether the list was really stored: storage can be unavailable, full or blocked.
function writeFavorites(items, storage) {
  const target = getStorage(storage);
  let stored = false;
  try {
    if (!target) throw new Error('No storage');
    if (items.length === 0) target.removeItem(FAVORITES_KEY);
    else target.setItem(FAVORITES_KEY, JSON.stringify({ version: 1, items }));
    stored = true;
  } catch { /* The visible list keeps reflecting what is actually stored. */ }
  cachedRaw = undefined;
  notify();
  return stored;
}

export function isFavorite(id, items = readFavorites()) {
  return items.some((item) => item.id === String(id));
}

export function addFavorite(plan, storage) {
  const item = sanitizeItem({ id: plan?.id, title: plan?.title, savedAt: new Date().toISOString() });
  if (!item) return false;
  const items = readFavorites(storage).filter((existing) => existing.id !== item.id);
  return writeFavorites([item, ...items].slice(0, MAX_FAVORITES), storage);
}

export function removeFavorite(id, storage) {
  return writeFavorites(readFavorites(storage).filter((item) => item.id !== String(id)), storage);
}

// The API resolves merged plans to their canonical id: keep one entry under that id.
export function replaceFavoriteId(oldId, plan, storage) {
  const items = readFavorites(storage);
  const index = items.findIndex((item) => item.id === String(oldId));
  if (index === -1 || !plan?.id) return false;
  const updated = sanitizeItem({ ...items[index], id: plan.id, title: plan.title || items[index].title });
  if (!updated) return false;
  const next = items.filter((item, position) => position !== index && item.id !== updated.id);
  next.splice(Math.min(index, next.length), 0, updated);
  return writeFavorites(next, storage);
}

let cachedRaw;
let cachedItems = [];

function snapshot() {
  let raw = null;
  try { raw = getStorage()?.getItem(FAVORITES_KEY) ?? null; } catch { raw = null; }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedItems = readFavorites();
  }
  return cachedItems;
}

function subscribe(callback) {
  const onStorage = (event) => { if (!event.key || event.key === FAVORITES_KEY) callback(); };
  globalThis.addEventListener?.(CHANGE_EVENT, callback);
  globalThis.addEventListener?.('storage', onStorage);
  return () => {
    globalThis.removeEventListener?.(CHANGE_EVENT, callback);
    globalThis.removeEventListener?.('storage', onStorage);
  };
}

export function useFavorites() {
  const items = useSyncExternalStore(subscribe, snapshot, () => []);
  // Returns the new saved state, or null when the change could not be stored.
  const toggle = useCallback((plan) => {
    const saved = isFavorite(plan.id, readFavorites());
    const stored = saved ? removeFavorite(plan.id) : addFavorite(plan);
    return stored ? !saved : null;
  }, []);
  return { items, toggle, isFavorite: (id) => isFavorite(id, items) };
}
