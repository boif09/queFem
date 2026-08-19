import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Pagination } from '../components/Pagination.jsx';
import { PlanList } from '../components/PlanList.jsx';
import { SearchFilters } from '../components/SearchFilters.jsx';
import { EmptyState, ErrorState, LoadingState } from '../components/States.jsx';
import { api } from '../services/api.js';
import { formatDate } from '../utils/dates.js';
import { createPlansSearch, filtersFromSearchParams } from '../utils/search.js';

function ActiveFilters({ filters }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const language = i18n.resolvedLanguage?.startsWith('es') ? 'es' : 'ca';
  const items = [
    filters.q && t('filter.query', { query: filters.q }),
    filters.date && t('filter.date', { value: formatDate(filters.date, language) }),
    filters.dateFrom && filters.dateTo && t('filter.range', {
      from: formatDate(filters.dateFrom, language), to: formatDate(filters.dateTo, language),
    }),
    filters.comarca && t('filter.comarca', { value: filters.comarca }),
    filters.municipality && t('filter.municipality', { value: filters.municipality }),
    filters.category && t('filter.category', { value: filters.category }),
    filters.free && t('filter.free'),
  ].filter(Boolean);
  return (
    <div className="active-filters">
      <strong>{t('results.activeFilters')}</strong>
      <div>{items.length ? items.map((item) => <span key={item}>{item}</span>) : <span>{t('results.noActiveFilters')}</span>}</div>
    </div>
  );
}

export function PlansPage() {
  const { t, i18n } = useTranslation();
  const [searchParams] = useSearchParams();
  const [state, setState] = useState({ status: 'loading', plans: [], pagination: null });
  const [reloadKey, setReloadKey] = useState(0);
  const searchKey = searchParams.toString();
  const filters = useMemo(() => filtersFromSearchParams(searchParams), [searchKey]);
  const language = i18n.resolvedLanguage?.startsWith('es') ? 'es' : 'ca';
  const page = searchParams.get('page') || '1';
  const sort = filters.date || filters.dateFrom || filters.dateTo ? 'date' : 'quality';

  useEffect(() => {
    let active = true;
    setState((current) => ({ ...current, status: 'loading' }));
    api.getPlans({ ...filters, page, limit: 12, sort, lang: language })
      .then((payload) => active && setState({ status: 'success', plans: payload.data, pagination: payload.pagination }))
      .catch(() => active && setState({ status: 'error', plans: [], pagination: null }));
    return () => { active = false; };
  }, [searchKey, language, reloadKey, sort]);

  const homeQuery = createPlansSearch(filters);
  const applyFilters = (nextFilters) => {
    const query = createPlansSearch(nextFilters);
    navigate(query ? `/plans?${query}` : '/plans');
  };
  return (
    <section className="results-page page-section">
      <div className="container">
        <header className="results-header">
          <div><p className="eyebrow dark">{t('results.eyebrow')}</p><h1>{filters.q || t('results.title')}</h1></div>
          <Link className="button button-secondary" to={homeQuery ? `/?${homeQuery}` : '/'}>{t('results.changeSearch')}</Link>
        </header>
        <details className="results-filters" id="filters" defaultOpen={Boolean(location.state?.openFilters)}>
          <summary>{t('results.filtersToggle')}</summary>
          <SearchFilters key={searchKey} initialFilters={filters} onSearch={applyFilters} />
        </details>
        <ActiveFilters filters={filters} />
        {state.status === 'loading' && <LoadingState />}
        {state.status === 'error' && <ErrorState onRetry={() => setReloadKey((value) => value + 1)} />}
        {state.status === 'success' && (
          <>
            <p className="result-count">{t('results.count', { count: state.pagination.total })}</p>
            {state.plans.length > 0 ? <PlanList plans={state.plans} /> : <EmptyState />}
            <Pagination pagination={state.pagination} />
          </>
        )}
      </div>
    </section>
  );
}
