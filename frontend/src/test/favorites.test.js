import { describe, expect, it } from 'vitest';
import { addFavorite, FAVORITES_KEY, isFavorite, MAX_FAVORITES, readFavorites, removeFavorite, replaceFavoriteId } from '../utils/favorites.js';

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key), values };
}

describe('favourites storage', () => {
  it('stores only the id, title and save date, newest first and without duplicates', () => {
    const storage = memoryStorage();
    addFavorite({ id: 7, title: '  Concert  ', description: 'no', image: { url: 'x' } }, storage);
    addFavorite({ id: 'p-9', title: 'Fira' }, storage);
    addFavorite({ id: 7, title: 'Concert' }, storage);
    const stored = JSON.parse(storage.values.get(FAVORITES_KEY));
    expect(stored.version).toBe(1);
    expect(stored.items.map((item) => Object.keys(item).sort())).toEqual([['id', 'savedAt', 'title'], ['id', 'savedAt', 'title']]);
    expect(readFavorites(storage).map((item) => [item.id, item.title])).toEqual([['7', 'Concert'], ['p-9', 'Fira']]);
    expect(isFavorite(7, readFavorites(storage))).toBe(true);
  });

  it('removes items, deletes the key when empty and caps the list', () => {
    const storage = memoryStorage();
    addFavorite({ id: 1, title: 'A' }, storage);
    removeFavorite('1', storage);
    expect(storage.values.has(FAVORITES_KEY)).toBe(false);
    for (let id = 0; id < MAX_FAVORITES + 5; id += 1) addFavorite({ id, title: `Pla ${id}` }, storage);
    expect(readFavorites(storage)).toHaveLength(MAX_FAVORITES);
    expect(readFavorites(storage)[0].id).toBe(String(MAX_FAVORITES + 4));
  });

  it('ignores corrupt or unknown data and survives blocked storage', () => {
    const storage = memoryStorage({ [FAVORITES_KEY]: '{broken' });
    expect(readFavorites(storage)).toEqual([]);
    storage.values.set(FAVORITES_KEY, JSON.stringify({ version: 2, items: [{ id: 1 }] }));
    expect(readFavorites(storage)).toEqual([]);
    storage.values.set(FAVORITES_KEY, JSON.stringify({ version: 1, items: [{ id: '' }, null, { id: 3, title: 4, savedAt: 'nope' }] }));
    expect(readFavorites(storage)).toEqual([{ id: '3', title: '', savedAt: null }]);
    const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => {} };
    expect(addFavorite({ id: 1, title: 'A' }, blocked)).toBe(false);
    expect(addFavorite({ id: 1, title: 'A' }, memoryStorage())).toBe(true);
  });

  it('moves a merged plan to its canonical id without duplicating it', () => {
    const storage = memoryStorage();
    addFavorite({ id: 'canonical', title: 'Fira' }, storage);
    addFavorite({ id: 'alias', title: 'Fira antiga' }, storage);
    replaceFavoriteId('alias', { id: 'canonical', title: 'Fira' }, storage);
    expect(readFavorites(storage).map((item) => item.id)).toEqual(['canonical']);
  });
});
