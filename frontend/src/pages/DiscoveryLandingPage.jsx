import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Pagination } from '../components/Pagination.jsx';
import { PlanList } from '../components/PlanList.jsx';
import { ActiveFilters } from '../components/ActiveFilters.jsx';
import { FiltersPanel } from '../components/FiltersPanel.jsx';
import { Seo } from '../components/Seo.jsx';
import { EmptyState, ErrorState, LoadingState } from '../components/States.jsx';
import { api } from '../services/api.js';
import { getCataloniaQuickDateRange } from '../utils/dates.js';
import { readLocationPreference, saveLocationPreference } from '../utils/locationPreference.js';
import { createPlansSearch, filtersFromSearchParams } from '../utils/search.js';

const LANDINGS = {
  today: { path: '/avui', key: 'today' },
  weekend: { path: '/cap-de-setmana', key: 'weekend' },
};
const LANDING_FILTER_KEYS = ['q', 'province', 'comarca', 'municipality', 'category', 'free'];

function landingFiltersFromSearchParams(searchParams) {
  const parsed = filtersFromSearchParams(searchParams);
  return Object.fromEntries(LANDING_FILTER_KEYS.filter((key) => parsed[key]).map((key) => [key, parsed[key]]));
}

export function DiscoveryLandingPage({ type, now }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [state, setState] = useState({ status: 'loading', plans: [], pagination: null });
  const [reloadKey, setReloadKey] = useState(0);
  const landing = LANDINGS[type];
  const language = i18n.resolvedLanguage?.startsWith('es') ? 'es' : 'ca';
  const range = useMemo(
    () => getCataloniaQuickDateRange(type, now || new Date()),
    [type, now],
  );
  const rangeKey = JSON.stringify(range);
  const searchKey = searchParams.toString();
  const filters = useMemo(() => landingFiltersFromSearchParams(searchParams), [searchKey]);
  const filtersKey = JSON.stringify(filters);
  const requestedPage = Number(searchParams.get('page'));
  const page = Number.isInteger(requestedPage) && requestedPage >= 1 && requestedPage <= 200 ? requestedPage : 1;
  const queryVariant = searchParams.size > 0;

  useEffect(() => {
    let active = true;
    setState((current) => ({ ...current, status: 'loading' }));
    const parameters = type === 'weekend'
      ? { ...filters, ...range, permanent: false, editorial: 'home-weekend', sort: 'date', page, limit: 24, lang: language }
      : { ...filters, ...range, sort: 'date', page, limit: 24, lang: language };
    api.getPlans(parameters)
      .then((payload) => active && setState({ status: 'success', plans: payload.data, pagination: payload.pagination }))
      .catch(() => active && setState({ status: 'error', plans: [], pagination: null }));
    return () => { active = false; };
  }, [type, rangeKey, filtersKey, page, language, reloadKey]);

  const applyFilters = useCallback((nextFilters) => {
    const safeFilters = Object.fromEntries(LANDING_FILTER_KEYS.filter((key) => nextFilters[key]).map((key) => [key, nextFilters[key]]));
    const query = createPlansSearch(safeFilters);
    navigate(query ? `${landing.path}?${query}` : landing.path, { replace: true });
  }, [landing.path, navigate]);
  const removeFilter = (key) => {
    const next = { ...filters };
    if (key.startsWith('category:')) {
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

  return <><Seo
    title={t(`seo.${landing.key}Title`)}
    description={t(`seo.${landing.key}Description`)}
    canonicalPath={queryVariant ? null : landing.path}
    robots={queryVariant ? 'noindex,follow' : 'index,follow'}
  />
  <section className="page-section discovery-landing-page">
    <div className="container">
      <header className="page-heading">
        <p className="eyebrow dark">{t(`landing.${landing.key}.eyebrow`)}</p>
        <h1>{t(`landing.${landing.key}.title`)}</h1>
        <p>{t(`landing.${landing.key}.intro`)}</p>
      </header>
      <FiltersPanel initialFilters={filters} onSearch={applyFilters} hideDateSection />
      <ActiveFilters filters={filters} onRemove={removeFilter} onClear={() => { saveLocationPreference({}); applyFilters({}); }} />
      {state.status === 'loading' && <LoadingState />}
      {state.status === 'error' && <ErrorState onRetry={() => setReloadKey((value) => value + 1)} />}
      {state.status === 'success' && state.plans.length === 0 && <EmptyState />}
      {state.status === 'success' && state.plans.length > 0 && <><PlanList plans={state.plans} /><Pagination pagination={state.pagination} /></>}
    </div>
  </section></>;
}
