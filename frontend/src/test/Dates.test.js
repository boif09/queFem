import { describe, expect, it } from 'vitest';
import { getCataloniaQuickDateRange } from '../utils/dates.js';

describe('Europe/Madrid discovery date ranges', () => {
  it('uses the Catalonia calendar day instead of UTC for today', () => {
    expect(getCataloniaQuickDateRange('today', new Date('2026-06-30T22:30:00.000Z')))
      .toEqual({ date: '2026-07-01' });
  });

  it.each([
    ['Thursday', '2026-09-10T10:00:00.000Z', '2026-09-11', '2026-09-13'],
    ['Friday', '2026-09-11T10:00:00.000Z', '2026-09-11', '2026-09-13'],
    ['Saturday', '2026-09-12T10:00:00.000Z', '2026-09-11', '2026-09-13'],
    ['Sunday', '2026-09-13T10:00:00.000Z', '2026-09-11', '2026-09-13'],
    ['Monday', '2026-09-14T10:00:00.000Z', '2026-09-18', '2026-09-20'],
  ])('maps %s to the intended Friday-Sunday window', (_day, instant, dateFrom, dateTo) => {
    expect(getCataloniaQuickDateRange('weekend', new Date(instant))).toEqual({ dateFrom, dateTo });
  });
});
