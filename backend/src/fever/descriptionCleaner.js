import { decodeHTML } from 'entities';

const MAXIMUM_ENTITY_DECODING_PASSES = 3;

function decodeEntitiesRepeatedly(value) {
  let decoded = value;
  for (let pass = 0; pass < MAXIMUM_ENTITY_DECODING_PASSES; pass += 1) {
    const next = decodeHTML(decoded);
    if (next === decoded) break;
    decoded = next;
  }
  return decoded;
}

export function cleanFeverDescription(value, { maximumLength = 10_000 } = {}) {
  if (typeof value !== 'string' || !value.trim()) return null;

  // Decode first so encoded markup cannot be reintroduced after sanitization. Three passes
  // cover reasonably nested feed encoding without allowing unbounded adversarial work.
  let cleaned = decodeEntitiesRepeatedly(value)
    .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n• ')
    .replace(/<\/(?:p|div|li|h[1-6]|section|article|ul|ol)>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/(^|\s)[.#]?[a-z_-][\w-]*(?:\s+[.#]?[a-z_-][\w-]*)*\s*\{[^{}]{0,1000}\}/gi, ' ')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replace(/[\p{Zs}\t]+/gu, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!cleaned) return null;
  if (cleaned.length <= maximumLength) return cleaned;
  return cleaned.slice(0, maximumLength).trimEnd();
}
