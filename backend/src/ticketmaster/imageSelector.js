const TARGETS = Object.freeze({
  card: { width: 640, height: 360 },
  detail: { width: 1136, height: 639 },
});

function validImage(image) {
  if (!image || typeof image !== 'object') return false;
  try {
    const url = new URL(image.url);
    if (url.protocol !== 'https:') return false;
  } catch {
    return false;
  }
  return Number.isInteger(Number(image.width)) && Number(image.width) > 0
    && Number.isInteger(Number(image.height)) && Number(image.height) > 0;
}

function normalizedImage(image) {
  return {
    url: new URL(image.url).toString(),
    ratio: typeof image.ratio === 'string' ? image.ratio : null,
    width: Number(image.width),
    height: Number(image.height),
    isFallback: image.fallback === true,
    attribution: typeof image.attribution === 'string' && image.attribution.length > 0
      ? image.attribution
      : null,
  };
}

function distance(image, target) {
  return Math.abs(image.width - target.width) + Math.abs(image.height - target.height);
}

export function selectTicketmasterImage(images, role) {
  const target = TARGETS[role];
  if (!target) throw new TypeError(`Rol d'imatge desconegut: ${role}`);
  const candidates = (Array.isArray(images) ? images : [])
    .filter(validImage)
    .map(normalizedImage)
    .filter((image) => image.width <= 2048 && image.height <= 2048)
    .sort((a, b) => (
      Number(b.ratio === '16_9') - Number(a.ratio === '16_9')
      || Number(a.isFallback) - Number(b.isFallback)
      || distance(a, target) - distance(b, target)
      || a.width - b.width
      || a.url.localeCompare(b.url)
    ));
  return candidates[0] || null;
}

export function selectTicketmasterImages(images) {
  return {
    card: selectTicketmasterImage(images, 'card'),
    detail: selectTicketmasterImage(images, 'detail'),
  };
}
