// Sources (mostly Gencat) send the price as one free Catalan text, often starting with a redundant "Preu:" or "Preus:".
// The label is dropped in every language (the card and the plan page already say it is a price), and the few plain
// shapes that carry no other words are shown in the interface language. Anything else stays as the source wrote it:
// plan content is not translated (see docs/DECISIONS.md).
const AMOUNT = '(\\d+(?:[.,]\\d+)?)\\s*€?';
const LABEL = /^preus?\s*(?::\s*|(?=\d))/i;
const RANGE = new RegExp(`^de\\s+${AMOUNT}\\s+a\\s+${AMOUNT}$`, 'i');
const FROM = new RegExp(`^(?:des de|a partir de)\\s+${AMOUNT}$`, 'i');

export function formatPriceText(text, t) {
  if (typeof text !== 'string') return text;
  const original = text.trim();
  const withoutLabel = original.replace(LABEL, '').trim();
  if (!withoutLabel) return original;

  const range = withoutLabel.match(RANGE);
  if (range) return `${range[1]}–${range[2]} €`;
  const from = withoutLabel.match(FROM);
  if (from) return t('plan.priceFrom', { amount: from[1] });

  return withoutLabel === original ? original : withoutLabel.charAt(0).toUpperCase() + withoutLabel.slice(1);
}
