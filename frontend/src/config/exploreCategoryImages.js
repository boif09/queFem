const EXPLORE_CATEGORY_IMAGES = Object.freeze({
  cultura: { src: '/images/explore/cultura.webp', objectPosition: '50% 46%' },
  espectacles: { src: '/images/explore/espectacles.webp', objectPosition: '50% 58%' },
  familia: { src: '/images/explore/familia.webp', objectPosition: '50% 68%' },
  festes: { src: '/images/explore/festes.webp', objectPosition: '50% 50%' },
  'fires-mercats': { src: '/images/explore/fires-mercats.webp', objectPosition: '34% 50%' },
  gastronomia: { src: '/images/explore/gastronomia.webp', objectPosition: '50% 54%' },
});

// The home page shows eight categories. They used to be the first eight in alphabetical order, which put empty categories
// on the front page; this is now an explicit, editorial order (most useful first). A category with no photo here shows
// the pattern artwork. Categories missing from the catalogue are skipped and the rest are appended in catalogue order.
export const HOME_EXPLORE_ORDER = Object.freeze([
  'cultura', 'espectacles', 'musica', 'familia', 'festes', 'gastronomia', 'patrimoni', 'natura',
]);
export const HOME_EXPLORE_LIMIT = 8;

export function homeExploreCategories(categories) {
  const bySlug = new Map(categories.map((category) => [category.slug, category]));
  const ordered = HOME_EXPLORE_ORDER.map((slug) => bySlug.get(slug)).filter(Boolean);
  const rest = categories.filter((category) => !HOME_EXPLORE_ORDER.includes(category.slug));
  return [...ordered, ...rest].slice(0, HOME_EXPLORE_LIMIT);
}

export function getExploreCategoryImage(slug) {
  return EXPLORE_CATEGORY_IMAGES[slug] || null;
}
