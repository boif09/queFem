const CATEGORY_RULES = [
  ['familia', ['familiar', 'infantil', 'nens', 'nadons']],
  ['musica', ['ambits/musica', 'categories/concerts', 'jazz', 'opera']],
  ['espectacles', ['ambits/espectacles', 'arts-esceniques', 'teatre', 'dansa', 'circ', 'titelles', 'magia']],
  ['festes', ['tradicional-i-popular', 'festes', 'festa-major', 'carnaval', 'castellers', 'gegants', 'correfoc']],
  ['fires-mercats', ['fires', 'mercats', 'fira-mercat']],
  ['gastronomia', ['gastronomia', 'gastronomic', 'enologia']],
  ['museus', ['museus', 'museu']],
  ['patrimoni', ['patrimoni', 'monuments', 'rutes-i-visites']],
  ['cultura', ['arts-visuals', 'cinema', 'divulgacio', 'llibres-i-lletres', 'literatura', 'exposicions', 'conferencies']],
];

export function normalizeCategories(record) {
  const tags = [record.tags_mbits, record.tags_categor_es, record.tags_altres_categor_es]
    .filter(Boolean)
    .join(',')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('ca');

  return CATEGORY_RULES
    .filter(([, matches]) => matches.some((match) => tags.includes(match)))
    .map(([slug]) => slug);
}

export function isFamilyFriendly(record) {
  return normalizeCategories(record).includes('familia') ? 1 : null;
}
