import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Pagination } from '../components/Pagination.jsx';
import { PlanList } from '../components/PlanList.jsx';
import { SearchFilters } from '../components/SearchFilters.jsx';
import { Seo } from '../components/Seo.jsx';
import { EmptyState, ErrorState, LoadingState } from '../components/States.jsx';
import { api } from '../services/api.js';
import { formatDate } from '../utils/dates.js';
import { readLocationPreference, saveLocationPreference } from '../utils/locationPreference.js';
import { createPlansSearch, filtersFromSearchParams } from '../utils/search.js';

function ActiveFilters({ filters, onRemove, onClear }) {
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

export function PlansPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const filtersPanelRef = useRef(null);
  const [state, setState] = useState({ status: 'loading', plans: [], pagination: null });
  const [reloadKey, setReloadKey] = useState(0);
  const searchKey = searchParams.toString();
  const filters = useMemo(() => filtersFromSearchParams(searchParams), [searchKey]);
  const language = i18n.resolvedLanguage?.startsWith('es') ? 'es' : 'ca';
  const page = searchParams.get('page') || '1';
  const sort = filters.date || filters.dateFrom || filters.dateTo ? 'date' : 'quality';
  const filtered = searchParams.size > 0;

  useEffect(() => {
    if (location.state?.openFilters && filtersPanelRef.current) filtersPanelRef.current.open = true;
  }, [location.state]);

  useEffect(() => {
    let active = true;
    setState((current) => ({ ...current, status: 'loading' }));
    api.getPlans({ ...filters, page, limit: 12, sort, lang: language })
      .then((payload) => active && setState({ status: 'success', plans: payload.data, pagination: payload.pagination }))
      .catch(() => active && setState({ status: 'error', plans: [], pagination: null }));
    return () => { active = false; };
  }, [searchKey, language, reloadKey, sort]);

  const homeQuery = createPlansSearch(filters);
  const applyFilters = useCallback((nextFilters) => {
    const query = createPlansSearch(nextFilters);
    navigate(query ? `/plans?${query}` : '/plans', { replace: true });
  }, [navigate]);
  const removeFilter = (key) => {
    const next = { ...filters };
    if (key === 'range') { delete next.dateFrom; delete next.dateTo; }
    else if (key.startsWith('category:')) {
      const category = key.slice('category:'.length);
      next.category = (next.category || '').split(',').filter((value) => value !== category).join(',');
    } else delete next[key];
    if (['province', 'comarca', 'municipality'].includes(key)) {
      const preference = readLocationPreference();
      delete preference[key];
      saveLocationPreference(preference);
    }
    applyFilters(next);
  };
  return (
    <><Seo
      title={t('seo.plansTitle')}
      description={t('seo.plansDescription')}
      canonicalPath={filtered ? null : '/plans'}
      robots={filtered ? 'noindex,follow' : 'index,follow'}
    />
    <section className="results-page page-section">
      <div className="container">
        <header className="results-header">
          <div><p className="eyebrow dark">{t('results.eyebrow')}</p><h1>{filters.q || t('results.title')}</h1></div>
          <Link className="button button-secondary" to={homeQuery ? `/?${homeQuery}` : '/'}>{t('results.changeSearch')}</Link>
        </header>
        <details ref={filtersPanelRef} className="results-filters" id="filters">
          <summary>{t('results.filtersToggle')}</summary>
          <SearchFilters initialFilters={filters} onSearch={applyFilters} />
        </details>
        <ActiveFilters filters={filters} onRemove={removeFilter} onClear={() => { saveLocationPreference({}); applyFilters({}); }} />
        {state.status === 'loading' && <LoadingState />}
        {state.status === 'error' && <ErrorState onRetry={() => setReloadKey((value) => value + 1)} />}
        {state.status === 'success' && (
          <>
            <p className="result-count">{t('results.count', { count: state.pagination.total })}</p>
            {state.plans.length > 0 ? <PlanList plans={state.plans} /> : <div className="filtered-empty"><EmptyState /><button type="button" className="button button-primary" onClick={() => applyFilters({})}>{t('filters.clear')}</button></div>}
            <Pagination pagination={state.pagination} />
          </>
        )}
      </div>
    </section></>
  );
}
