import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Pagination } from '../components/Pagination.jsx';
import { PlanList } from '../components/PlanList.jsx';
import { Seo } from '../components/Seo.jsx';
import { EmptyState, ErrorState, LoadingState } from '../components/States.jsx';
import { api } from '../services/api.js';
import { getCataloniaQuickDateRange } from '../utils/dates.js';
import { filtersFromSearchParams } from '../utils/search.js';

const LANDINGS = {
  today: { path: '/avui', key: 'today' },
  weekend: { path: '/cap-de-setmana', key: 'weekend' },
};

export function DiscoveryLandingPage({ type, now }) {
  const { t, i18n } = useTranslation();
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
  const locationFilters = useMemo(() => {
    const filters = filtersFromSearchParams(searchParams);
    return Object.fromEntries(['province', 'comarca', 'municipality']
      .filter((key) => filters[key])
      .map((key) => [key, filters[key]]));
  }, [searchKey]);
  const locationKey = JSON.stringify(locationFilters);
  const requestedPage = Number(searchParams.get('page'));
  const page = Number.isInteger(requestedPage) && requestedPage >= 1 && requestedPage <= 200 ? requestedPage : 1;
  const queryVariant = searchParams.size > 0;

  useEffect(() => {
    let active = true;
    setState((current) => ({ ...current, status: 'loading' }));
    const parameters = type === 'weekend'
      ? { ...locationFilters, ...range, permanent: false, editorial: 'home-weekend', sort: 'date', page, limit: 24, lang: language }
      : { ...locationFilters, ...range, sort: 'date', page, limit: 24, lang: language };
    api.getPlans(parameters)
      .then((payload) => active && setState({ status: 'success', plans: payload.data, pagination: payload.pagination }))
      .catch(() => active && setState({ status: 'error', plans: [], pagination: null }));
    return () => { active = false; };
  }, [type, rangeKey, locationKey, page, language, reloadKey]);

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
      {state.status === 'loading' && <LoadingState />}
      {state.status === 'error' && <ErrorState onRetry={() => setReloadKey((value) => value + 1)} />}
      {state.status === 'success' && state.plans.length === 0 && <EmptyState />}
      {state.status === 'success' && state.plans.length > 0 && <><PlanList plans={state.plans} /><Pagination pagination={state.pagination} /></>}
    </div>
  </section></>;
}
