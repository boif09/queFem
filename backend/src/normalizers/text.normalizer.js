const CATALAN_ARTICLES = new Set([
  'el', 'els', 'la', 'les', 'l', 'un', 'uns', 'una', 'unes',
  'de', 'del', 'dels', 'd', 'al', 'als',
]);

export function stripHtml(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;

  return value
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/p>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, ' ')
    .trim() || null;
}

export function normalizeForFingerprint(value, { removeArticles = false } = {}) {
  const tokens = String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('ca')
    .replace(/[’']/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  return (removeArticles ? tokens.filter((token) => !CATALAN_ARTICLES.has(token)) : tokens)
    .join('-');
}

export function nullableString(value) {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}
