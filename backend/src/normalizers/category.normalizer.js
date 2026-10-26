const CATEGORY_RULES = [
  ['familia', ['familiar', 'infantil', 'nens', 'nadons']],
  ['musica', ['ambits/musica', 'categories/concerts', 'jazz', 'opera']],
  ['espectacles', ['ambits/espectacles', 'arts-esceniques', 'teatre', 'dansa', 'circ', 'titelles', 'magia']],
  ['festes', ['tradicional-i-popular', 'festes', 'festa-major', 'carnaval', 'castellers', 'gegants', 'correfoc']],
  ['fires-mercats', ['fires', 'mercats', 'fira-mercat']],
  ['gastronomia', ['gastronomia', 'gastronomic', 'enologia']],
  ['museus', ['museus', 'museu']],
  ['patrimoni', ['patrimoni', 'monuments', 'rutes-i-visites']],
  ['exposicions', ['exposicions']],
  ['cinema', ['cinema']],
  ['cultura', ['divulgacio', 'llibres-i-lletres', 'literatura', 'conferencies']],
];

export function normalizeCategories(record) {
  const tags = [record.tags_mbits, record.tags_categor_es, record.tags_altres_categor_es]
    .filter(Boolean)
    .join(',')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('ca');

  const slugs = CATEGORY_RULES
    .filter(([, matches]) => matches.some((match) => tags.includes(match)))
    .map(([slug]) => slug);
  // The broad "arts-visuals" tag is Cultura only when the plan is not already an exhibition or a film.
  if (tags.includes('arts-visuals') && !slugs.some((slug) => ['exposicions', 'cinema', 'cultura'].includes(slug))) slugs.push('cultura');
  return slugs;
}

export function isFamilyFriendly(record) {
  return normalizeCategories(record).includes('familia') ? 1 : null;
}
