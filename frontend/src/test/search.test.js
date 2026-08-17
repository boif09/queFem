import { describe, expect, it } from 'vitest';
import { createPlansSearch, filtersFromSearchParams } from '../utils/search.js';

describe('search URL utilities', () => {
  it('keeps the important filters in shareable query parameters', () => {
    const query = createPlansSearch({
      dateFrom: '2026-08-22',
      dateTo: '2026-08-23',
      comarca: 'Baix Empordà',
      municipality: 'Begur',
      category: 'cultura',
      free: true,
    });
    const parsed = filtersFromSearchParams(new URLSearchParams(query));

    expect(parsed).toEqual({
      dateFrom: '2026-08-22',
      dateTo: '2026-08-23',
      comarca: 'Baix Empordà',
      municipality: 'Begur',
      category: 'cultura',
      free: 'true',
    });
  });
});
