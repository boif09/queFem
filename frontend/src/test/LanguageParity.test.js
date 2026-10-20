import { describe, expect, it } from 'vitest';
import ca from '../locales/ca/translation.json';
import es from '../locales/es/translation.json';
import en from '../locales/en/translation.json';
import caLegal from '../locales/ca/legal.json';
import esLegal from '../locales/es/legal.json';
import enLegal from '../locales/en/legal.json';
import { categoryName, contentLanguage, uiLanguage } from '../utils/language.js';

// Keys that only exist in English because they are shown only there.
const ENGLISH_ONLY = (key) => key.startsWith('categories.') || key === 'app.contentNotice';

const flatten = (object, prefix = '') => Object.entries(object).flatMap(([key, value]) => (
  typeof value === 'object' ? flatten(value, `${prefix}${key}.`) : [`${prefix}${key}`]
));

describe('interface languages', () => {
  it('keeps the same translation keys in Catalan, Spanish and English', () => {
    const catalan = Object.keys(ca).sort();
    expect(Object.keys(es).sort()).toEqual(catalan);
    expect(Object.keys(en).filter((key) => !ENGLISH_ONLY(key)).sort()).toEqual(catalan);
  });

  it('keeps the same legal keys in all languages (English adds only its translation note)', () => {
    const catalan = flatten(caLegal).sort();
    expect(flatten(esLegal).sort()).toEqual(catalan);
    expect(flatten(enLegal).filter((key) => key !== 'common.translationNote').sort()).toEqual(catalan);
  });

  it('has an English name for every category in the reference data', () => {
    const slugs = ['festes', 'musica', 'espectacles', 'fires-mercats', 'gastronomia', 'cultura', 'familia', 'natura',
      'senderisme', 'muntanya', 'platges', 'bicicleta', 'miradors', 'patrimoni', 'museus', 'monuments', 'pobles', 'parcs-jardins'];
    slugs.forEach((slug) => expect(en[`categories.${slug}`], slug).toBeTruthy());
  });

  it('keeps interpolation placeholders identical across languages', () => {
    const placeholders = (text) => (String(text).match(/\{\{\w+\}\}/g) || []).sort().join();
    Object.keys(ca).forEach((key) => {
      expect(placeholders(en[key]), key).toBe(placeholders(ca[key]));
    });
  });

  it('resolves the UI language and asks the API for Spanish text when the UI is English', () => {
    expect(uiLanguage({ resolvedLanguage: 'en-GB' })).toBe('en');
    expect(uiLanguage({ resolvedLanguage: 'es' })).toBe('es');
    expect(uiLanguage({})).toBe('ca');
    expect(contentLanguage('en')).toBe('es');
    expect(contentLanguage('ca')).toBe('ca');
  });

  it('names categories in English and falls back to the stored names for unknown slugs', () => {
    const t = (key, { defaultValue }) => en[key] ?? defaultValue;
    expect(categoryName({ slug: 'museus', name_ca: 'Museus', name_es: 'Museos' }, 'en', t)).toBe('Museums');
    expect(categoryName({ slug: 'nou', name_ca: 'Nou', name_es: 'Nuevo' }, 'en', t)).toBe('Nuevo');
    expect(categoryName({ slug: 'museus', name_ca: 'Museus', name_es: 'Museos' }, 'ca', t)).toBe('Museus');
  });
});
