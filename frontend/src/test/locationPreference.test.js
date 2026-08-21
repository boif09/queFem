import { describe, expect, it } from 'vitest';
import { clearLocationPreference, formatLocationPreference, LOCATION_PREFERENCE_KEY, readLocationPreference, saveLocationPreference } from '../utils/locationPreference.js';

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key), values };
}

describe('location preference', () => {
  it('stores only explicitly supplied territory levels in a versioned namespaced value', () => {
    const storage = memoryStorage();
    saveLocationPreference({ comarca: 'Baix Empordà', q: 'concert', municipality: '  Begur  ' }, storage);
    expect(JSON.parse(storage.values.get(LOCATION_PREFERENCE_KEY))).toEqual({ version: 1, location: { comarca: 'Baix Empordà', municipality: 'Begur' } });
    expect(readLocationPreference(storage)).toEqual({ comarca: 'Baix Empordà', municipality: 'Begur' });
    expect(formatLocationPreference(readLocationPreference(storage))).toBe('Begur · Baix Empordà');
  });

  it('rejects corrupt or unknown versions and removes empty preferences defensively', () => {
    const storage = memoryStorage({ [LOCATION_PREFERENCE_KEY]: '{broken' });
    expect(readLocationPreference(storage)).toEqual({});
    storage.values.set(LOCATION_PREFERENCE_KEY, JSON.stringify({ version: 2, location: { province: 'Girona' } }));
    expect(readLocationPreference(storage)).toEqual({});
    saveLocationPreference({}, storage);
    expect(storage.values.has(LOCATION_PREFERENCE_KEY)).toBe(false);
    expect(() => clearLocationPreference({ removeItem: () => { throw new Error('blocked'); } })).not.toThrow();
  });
});
