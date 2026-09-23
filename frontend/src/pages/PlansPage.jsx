import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Pagination } from '../components/Pagination.jsx';
import { PlanList } from '../components/PlanList.jsx';
import { ActiveFilters } from '../components/ActiveFilters.jsx';
import { FiltersPanel } from '../components/FiltersPanel.jsx';
import { Seo } from '../components/Seo.jsx';
import { EmptyState, ErrorState, LoadingState } from '../components/States.jsx';
import { api } from '../services/api.js';
import { readLocationPreference, saveLocationPreference } from '../utils/locationPreference.js';
import { createPlansSearch, filtersFromSearchParams } from '../utils/search.js';

export function PlansPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [state, setState] = useState({ status: 'loading', plans: [], pagination: null });
  const [reloadKey, setReloadKey] = useState(0);
  const searchKey = searchParams.toString();
  const filters = useMemo(() => filtersFromSearchParams(searchParams), [searchKey]);
  const language = i18n.resolvedLanguage?.startsWith('es') ? 'es' : 'ca';
  const page = searchParams.get('page') || '1';
  const sort = filters.date || filters.dateFrom || filters.dateTo ? 'date' : 'quality';
  const filtered = searchParams.size > 0;

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
    <section className="results-page page-section discovery-page is-plans">
      <div className="container">
        <header className="results-header">
          <div><p className="eyebrow dark">{t('results.eyebrow')}</p><h1>{filters.q || t('results.title')}</h1></div>
          <Link className="button button-secondary" to={homeQuery ? `/?${homeQuery}` : '/'}>{t('results.changeSearch')}</Link>
        </header>
        <FiltersPanel initialFilters={filters} onSearch={applyFilters} openOnMount={Boolean(location.state?.openFilters)} />
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
