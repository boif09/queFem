import { describe, expect, it } from 'vitest';
import i18n from '../i18n.js';
import { formatPriceText } from '../utils/priceText.js';

const tIn = (language) => i18n.getFixedT(language);

describe('price text', () => {
  it('drops the redundant Catalan label in every language', () => {
    for (const language of ['ca', 'es', 'en']) {
      expect(formatPriceText('Preu: 20 €', tIn(language))).toBe('20 €');
      expect(formatPriceText('Preus 32 € Zona A 16 € Zona B', tIn(language))).toBe('32 € Zona A 16 € Zona B');
    }
  });

  it('shows plain ranges and "from" prices in the interface language', () => {
    expect(formatPriceText('Preus: de 6 a 20 €', tIn('en'))).toBe('6–20 €');
    expect(formatPriceText('de 6,50 a 18 €', tIn('es'))).toBe('6,50–18 €');
    expect(formatPriceText('Preus: des de 29 €', tIn('ca'))).toBe('Des de 29 €');
    expect(formatPriceText('Preus: des de 29 €', tIn('es'))).toBe('Desde 29 €');
    expect(formatPriceText('a partir de 15 €', tIn('en'))).toBe('From 15 €');
  });

  it('keeps longer source text as written, only without the label', () => {
    expect(formatPriceText('Preus: Entrada general: 7 € Entrada reduïda: 5 €', tIn('en'))).toBe('Entrada general: 7 € Entrada reduïda: 5 €');
    expect(formatPriceText('Preu: entrada Inclosa en el preu de l’entrada al Palau', tIn('es'))).toBe('Entrada Inclosa en el preu de l’entrada al Palau');
    expect(formatPriceText('Preu normal: 5,5 € Preu reduït: 4,5 €', tIn('en'))).toBe('Preu normal: 5,5 € Preu reduït: 4,5 €');
    expect(formatPriceText('Preus Entrada general: 12 €', tIn('en'))).toBe('Preus Entrada general: 12 €');
    expect(formatPriceText('Gratuït', tIn('en'))).toBe('Gratuït');
    expect(formatPriceText('10-12', tIn('en'))).toBe('10-12');
  });

  it('never empties a price or breaks on missing values', () => {
    expect(formatPriceText('Preu:', tIn('en'))).toBe('Preu:');
    expect(formatPriceText('  15 €  ', tIn('en'))).toBe('15 €');
    expect(formatPriceText(null, tIn('en'))).toBeNull();
    expect(formatPriceText(undefined, tIn('en'))).toBeUndefined();
  });
});
