import { describe, expect, it } from 'vitest';
import { resolveInitialLanguage } from '../i18n.js';

describe('initial interface language', () => {
  it('uses an explicit ?lang= from widget links before the stored preference', () => {
    expect(resolveInitialLanguage({ search: '?lang=es&utm_source=tenspla-widget', stored: 'ca' })).toBe('es');
    expect(resolveInitialLanguage({ search: '?lang=ca', stored: 'es' })).toBe('ca');
  });

  it('falls back to the stored preference and then to Catalan', () => {
    expect(resolveInitialLanguage({ search: '?lang=fr', stored: 'es' })).toBe('es');
    expect(resolveInitialLanguage({ search: '', stored: 'es' })).toBe('es');
    expect(resolveInitialLanguage({ search: '', stored: 'en' })).toBe('ca');
    expect(resolveInitialLanguage()).toBe('ca');
  });
});
