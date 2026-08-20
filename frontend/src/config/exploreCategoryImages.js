const EXPLORE_CATEGORY_IMAGES = Object.freeze({
  bicicleta: { src: '/images/explore/bicicleta.webp', objectPosition: '68% 62%' },
  cultura: { src: '/images/explore/cultura.webp', objectPosition: '50% 46%' },
  espectacles: { src: '/images/explore/espectacles.webp', objectPosition: '50% 58%' },
  familia: { src: '/images/explore/familia.webp', objectPosition: '50% 68%' },
  festes: { src: '/images/explore/festes.webp', objectPosition: '50% 50%' },
  'fires-mercats': { src: '/images/explore/fires-mercats.webp', objectPosition: '34% 50%' },
  gastronomia: { src: '/images/explore/gastronomia.webp', objectPosition: '50% 54%' },
  miradors: { src: '/images/explore/miradors.webp', objectPosition: '50% 52%' },
});

export function getExploreCategoryImage(slug) {
  return EXPLORE_CATEGORY_IMAGES[slug] || null;
}
