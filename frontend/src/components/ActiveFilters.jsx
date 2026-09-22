import { useTranslation } from 'react-i18next';
import { formatDate } from '../utils/dates.js';

export function ActiveFilters({ filters, onRemove, onClear }) {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage?.startsWith('es') ? 'es' : 'ca';
  const items = [
    filters.q && { key: 'q', label: t('filter.query', { query: filters.q }) },
    filters.date && { key: 'date', label: t('filter.date', { value: formatDate(filters.date, language) }) },
    filters.dateFrom && filters.dateTo && { key: 'range', label: t('filter.range', {
      from: formatDate(filters.dateFrom, language), to: formatDate(filters.dateTo, language),
    }) },
    filters.province && { key: 'province', label: t('filter.province', { value: filters.province }) },
    filters.comarca && { key: 'comarca', label: t('filter.comarca', { value: filters.comarca }) },
    filters.municipality && { key: 'municipality', label: t('filter.municipality', { value: filters.municipality }) },
    ...(filters.category || '').split(',').filter(Boolean).map((category) => ({ key: `category:${category}`, label: t('filter.category', { value: category }) })),
    filters.free && { key: 'free', label: t('filter.free') },
  ].filter(Boolean);
  return (
    <div className="active-filters">
      <strong>{t('results.activeFilters')}</strong>
      <div>{items.length ? items.map((item) => <button type="button" className="filter-chip" aria-label={t('filter.remove', { label: item.label })} key={item.key} onClick={() => onRemove(item.key)}><span className="filter-chip-label">{item.label}</span><span className="filter-chip-remove" aria-hidden="true">×</span></button>) : <span className="no-active-filters">{t('results.noActiveFilters')}</span>}</div>
      {items.length > 0 && <button type="button" className="clear-active-filters" onClick={onClear}>{t('filters.clear')}</button>}
    </div>
  );
}
