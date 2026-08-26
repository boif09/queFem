import assert from 'node:assert/strict';
import test from 'node:test';
import { feverCategorySlugs, normalizeFeverPrice, validFeverImageUrl } from '../backend/src/fever/publicationPolicy.js';
import { validateFeverImageUrl } from '../backend/src/ticketmaster/imageProxy.js';

test('Fever publication mapping uses SubCategory labels, never Tier metadata', () => {
  assert.deepEqual(feverCategorySlugs('Concerts, Music Events, Tier 4'), ['musica']);
  assert.deepEqual(feverCategorySlugs('Museums & Art Galleries, Family, Culture'), ['cultura', 'museus', 'familia']);
  assert.deepEqual(feverCategorySlugs('Other Experiences'), []);
});

test('Fever price policy is conservative for free, fixed, from and contradictory labels', () => {
  for (const value of [null, undefined, '', '   ', '22 EUR', '22abc']) {
    assert.deepEqual(normalizeFeverPrice(value, 'EUR', []), { type: 'unknown' });
  }
  assert.deepEqual(normalizeFeverPrice(0, 'EUR', []), { type: 'free', amount: 0, currency: 'EUR' });
  assert.deepEqual(normalizeFeverPrice('0', 'EUR', []), { type: 'free', amount: 0, currency: 'EUR' });
  assert.deepEqual(normalizeFeverPrice('0.00', 'EUR', []), { type: 'free', amount: 0, currency: 'EUR' });
  assert.deepEqual(normalizeFeverPrice(22, 'EUR', ['22 €']), { type: 'fixed', amount: 22, currency: 'EUR' });
  assert.deepEqual(normalizeFeverPrice(22, 'EUR', ['22 €', '30 €']), { type: 'from', amount: 22, currency: 'EUR' });
  assert.deepEqual(normalizeFeverPrice(22, 'EUR', ['30 €']), { type: 'unknown' });
  assert.deepEqual(normalizeFeverPrice(22, 'USD', ['22']), { type: 'unknown' });
});

test('Fever primary images require credential-free HTTPS on the observed exact host', () => {
  assert.equal(validFeverImageUrl('https://applications-media.feverup.com/image.jpg'), 'https://applications-media.feverup.com/image.jpg');
  for (const value of ['http://applications-media.feverup.com/a.jpg', 'https://evil.test/a.jpg',
    'https://user:pass@applications-media.feverup.com/a.jpg', 'not-a-url']) assert.equal(validFeverImageUrl(value), null);
  assert.equal(validateFeverImageUrl('https://applications-media.feverup.com/image.jpg').hostname, 'applications-media.feverup.com');
  assert.throws(() => validateFeverImageUrl('https://applications-media.feverup.com.evil.test/a.jpg'), /disponible/);
});
