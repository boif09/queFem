import { describe, expect, it } from 'vitest';
import { createPlansSearch, filtersFromSearchParams } from '../utils/search.js';

describe('search URL utilities', () => {
  it('keeps the important filters in shareable query parameters', () => {
    const query = createPlansSearch({
      q: 'weeknd',
      dateFrom: '2026-08-22',
      dateTo: '2026-08-23',
      comarca: 'Baix Empordà',
      municipality: 'Begur',
      category: 'cultura',
      free: true,
    });
    const parsed = filtersFromSearchParams(new URLSearchParams(query));

    expect(parsed).toEqual({
      q: 'weeknd',
      dateFrom: '2026-08-22',
      dateTo: '2026-08-23',
      comarca: 'Baix Empordà',
      municipality: 'Begur',
      category: 'cultura',
      free: 'true',
    });
  });

  it('omits an empty text query instead of creating q=', () => {
    expect(createPlansSearch({ q: '' })).toBe('');
    expect(createPlansSearch({ q: '   ' })).toBe('');
    expect(filtersFromSearchParams(new URLSearchParams('q='))).toEqual({});
    expect(filtersFromSearchParams(new URLSearchParams('q=%20%20'))).toEqual({});
  });
});
