import { describe, expect, it } from 'vitest';
import { createPlansSearch, filtersFromSearchParams } from '../utils/search.js';
import { getQuickDateRange } from '../utils/dates.js';

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
      kind: 'event',
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
      kind: 'event',
    });
  });

  it('omits an empty text query instead of creating q=', () => {
    expect(createPlansSearch({ q: '' })).toBe('');
    expect(createPlansSearch({ q: '   ' })).toBe('');
    expect(filtersFromSearchParams(new URLSearchParams('q='))).toEqual({});
    expect(filtersFromSearchParams(new URLSearchParams('q=%20%20'))).toEqual({});
  });
});

describe('quick date ranges', () => {
  it('uses today and tomorrow as single-date filters', () => {
    const monday = new Date(2026, 7, 17, 15);
    expect(getQuickDateRange('today', monday)).toEqual({ date: '2026-08-17' });
    expect(getQuickDateRange('tomorrow', monday)).toEqual({ date: '2026-08-18' });
  });

  it('uses Friday through Sunday and shortens an in-progress weekend', () => {
    expect(getQuickDateRange('weekend', new Date(2026, 7, 20))).toEqual({ dateFrom: '2026-08-21', dateTo: '2026-08-23' });
    expect(getQuickDateRange('weekend', new Date(2026, 7, 21))).toEqual({ dateFrom: '2026-08-21', dateTo: '2026-08-23' });
    expect(getQuickDateRange('weekend', new Date(2026, 7, 22))).toEqual({ dateFrom: '2026-08-22', dateTo: '2026-08-23' });
    expect(getQuickDateRange('weekend', new Date(2026, 7, 23))).toEqual({ dateFrom: '2026-08-23', dateTo: '2026-08-23' });
  });
});
