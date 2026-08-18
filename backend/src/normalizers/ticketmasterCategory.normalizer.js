export function normalizeTicketmasterCategories(record) {
  const text = [record.classificationSegment, record.classificationGenre,
    record.classificationSubGenre, record.classificationType, record.classificationSubType,
    record.segmentName, record.genreName, record.subGenreName, record.classification]
    .flatMap((value) => typeof value === 'object' ? Object.values(value || {}) : [value])
    .filter(Boolean).join(' ').toLowerCase();
  const categories = [];
  if (/music|música|musica|concert/.test(text)) categories.push('musica');
  if (/arts|theatre|theater|dance|circus|comedy|espectáculo|espectacle/.test(text)) categories.push('espectacles');
  if (/film|cinema|cultural/.test(text)) categories.push('cultura');
  if (/family|children|infantil/.test(text)) categories.push('familia');
  return [...new Set(categories)];
}
