import assert from 'node:assert/strict';
import test from 'node:test';
import { inferFreeStatus } from '../backend/src/normalizers/freeStatus.normalizer.js';

test('infers free from unqualified Catalan free wording', () => {
  const free = ['Gratuït', 'Gratuïta', 'Entrada gratuïta', 'Activitat gratuïta', '0 €', '0 EUR'];
  for (const text of free) {
    assert.equal(inferFreeStatus({ text }), 1, `expected free for ${JSON.stringify(text)}`);
  }
});

test('infers paid from explicit non-zero admission prices', () => {
  const paid = [
    'Preu: 16 €',
    '11 € adults i 7,70 € nens',
    '25 € adults i 17,50€ nens/es de 3 a 12 anys.',
  ];
  for (const text of paid) {
    assert.equal(inferFreeStatus({ text }), 0, `expected paid for ${JSON.stringify(text)}`);
  }
});

test('never infers globally free from conditional or mixed wording', () => {
  const conditional = [
    'Gratuït per a menors de 16 anys',
    'Accés gratuït per a membres',
    'Activitat gratuïta inclosa en el preu de l’entrada',
    // Accented masculine singular "inclòs" (cross-review finding: an earlier
    // version of CONDITIONAL_RE only matched the unaccented "inclos" stem
    // and missed this standard Catalan form, a genuine false-positive path).
    'Accés gratuït inclòs en el preu de l’entrada',
    'Entrada gratuïta amb carnet de soci',
    // "accés lliure" alone can mean free access, but here it's bundled with
    // a separate paid admission (cross-review finding).
    'Accés lliure a l’exposició amb l’entrada al museu',
  ];
  for (const text of conditional) {
    assert.notEqual(inferFreeStatus({ text }), 1, `must not be free: ${JSON.stringify(text)}`);
  }
  // Mentions a real base price alongside discount/exemption wording that is
  // itself conditional (an "ordinary paid tariff with subgroup/discount
  // gratuity"): the free-sounding word is inside the conditional phrase, so
  // the price wins cleanly — paid, not unresolved.
  assert.equal(
    inferFreeStatus({ text: 'Tarifa general: 5 euros. Consulteu descomptes i gratuïtats' }),
    0,
  );
});

test('a real price directly contradicting unconditional free wording in the same text is unresolved, not paid or free', () => {
  const mixed = [
    // An unconditional-sounding free claim next to a separate priced item:
    // a genuine contradiction within the text itself, not just an
    // unreliable flag disagreeing with a clean price.
    'Entrada gratuïta. Taller opcional: 5 €',
    'Accés lliure a la festa. Amb tiquet: 5 €',
    'Accés lliure amb consumició obligatòria de 10 €',
    // Same wording as above, unchanged: still must not collapse to paid.
    'Accés lliure a la festa al carrer. Amb tiquet: visita guiada 5 €',
  ];
  for (const text of mixed) {
    assert.equal(inferFreeStatus({ text }), null, `expected unresolved for ${JSON.stringify(text)}`);
  }
});

test('bare "accés lliure" is never treated as an unconditional free claim', () => {
  // Unlike "gratuït", "accés lliure" can describe access to only part of an
  // event while a separate paid component exists elsewhere, so on its own —
  // with no flag and no other signal — it stays unresolved rather than free.
  assert.equal(inferFreeStatus({ text: 'Accés lliure' }), null);
});

test('never infers globally free from eligibility-restricted free wording', () => {
  // Cross-review finding: a keyword list covering "per a X" and a handful of
  // nouns missed common single-word "per X" eligibility restrictions.
  const restricted = [
    'Entrada gratuïta per invitació',
    'Entrada gratuïta per acompanyants',
    'Entrada gratuïta per estudiants',
    'Entrada gratuïta per abonats',
    'Entrada gratuïta amb codi promocional',
    'Entrada gratuïta per residents',
  ];
  for (const text of restricted) {
    assert.equal(inferFreeStatus({ text }), null, `expected unresolved for ${JSON.stringify(text)}`);
  }
});

test('a conditional word qualifying a different clause does not suppress a genuine free/paid contradiction elsewhere in the text', () => {
  // Cross-review finding: an earlier version tested CONDITIONAL_RE against
  // the whole text, so "Descompte per a socis" — which qualifies the
  // *workshop's* price, not the free main entry — wrongly made the whole
  // plan look like an ordinary paid tariff (0) instead of unresolved (null).
  assert.equal(
    inferFreeStatus({ text: 'Entrada gratuïta. Taller opcional: 5 €. Descompte per a socis' }),
    null,
  );
  // Same finding, but with commas instead of periods separating clauses —
  // real DIBA/Gencat text often does this. An earlier version only split
  // clauses on periods/semicolons and missed this.
  assert.equal(
    inferFreeStatus({ text: 'Entrada gratuïta, taller opcional: 5 €, descompte per a socis' }),
    null,
  );
});

test('never infers globally free from further eligibility/restriction wording', () => {
  // Cross-review finding (round 3): additional realistic Catalan
  // restrictions not covered by the round-2 keyword list.
  const restricted = [
    'Entrada gratuïta per jubilats',
    'Entrada gratuïta per aturats',
    'Entrada gratuïta per infants',
    'Entrada gratuïta amb reserva prèvia',
    'Entrada gratuïta amb inscripció prèvia',
    'Entrada gratuïta per les primeres 50 persones',
    'Entrada gratuïta amb acreditació',
  ];
  for (const text of restricted) {
    assert.equal(inferFreeStatus({ text }), null, `expected unresolved for ${JSON.stringify(text)}`);
  }
});

test('an explicit non-zero price overrides an unreliable upstream free flag', () => {
  assert.equal(
    inferFreeStatus({ flag: 1, text: 'Preu: 16€ per família/grup (màxim 5 persones)' }),
    0,
  );
  // Simpler form of the same rule, using the exact wording of a Gencat
  // gratuita="Sí" contradiction: the flag alone is never enough to overcome
  // an explicit price in the text itself.
  assert.equal(inferFreeStatus({ flag: 1, text: 'Preu: 16 €' }), 0);
});

test('unqualified free text overrides an unreliable upstream paid flag', () => {
  assert.equal(inferFreeStatus({ flag: 0, text: 'Entrada gratuïta' }), 1);
});

test('unqualified free text is trusted even with no upstream flag at all', () => {
  assert.equal(inferFreeStatus({ flag: null, text: 'Entrada gratuïta' }), 1);
});

test('falls back to the upstream flag when there is no usable price text', () => {
  assert.equal(inferFreeStatus({ flag: null, text: '' }), null);
  assert.equal(inferFreeStatus({ flag: null, text: null }), null);
  assert.equal(inferFreeStatus({ flag: 1, text: '' }), 1);
  assert.equal(inferFreeStatus({ flag: 0, text: '' }), 0);
});

test('accepts boolean flags as well as the 0/1/null tri-state form', () => {
  assert.equal(inferFreeStatus({ flag: true, text: '' }), 1);
  assert.equal(inferFreeStatus({ flag: false, text: '' }), 0);
});
