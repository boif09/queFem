import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { BrandLogo } from '../components/BrandLogo.jsx';
import { ExploreCategoryArtwork } from '../components/ExploreCategoryArtwork.jsx';
import { PlanList } from '../components/PlanList.jsx';
import { Seo } from '../components/Seo.jsx';
import { EmptyState, ErrorState, LoadingState } from '../components/States.jsx';
import { api } from '../services/api.js';
import { getQuickDateRange } from '../utils/dates.js';
import { clearLocationPreference, formatLocationPreference, readLocationPreference } from '../utils/locationPreference.js';
import { createPlansSearch } from '../utils/search.js';

const HOME_PLAN_LIMIT = 6;

function QuickAction({ className, label, to, eyebrow }) {
  return <Link className={`quick-action ${className}`} to={to}><small>{eyebrow}</small><strong>{label}</strong><span aria-hidden="true">↗</span></Link>;
}

function PlanSection({ eyebrow, title, state, viewAllUrl, locationUrl, onRetry, locationActive, onClearLocation }) {
  const { t } = useTranslation();
  return <section className="home-section discovery-section">
    <div className="container">
      <header className="section-title-row"><div><p>{eyebrow}</p><h2>{title}</h2></div>{viewAllUrl && <Link to={viewAllUrl}>{t('home.viewAll')} →</Link>}</header>
      {state.status === 'loading' && <LoadingState />}
      {state.status === 'error' && <ErrorState onRetry={onRetry} />}
      {state.status === 'success' && state.plans.length > 0 && <PlanList plans={state.plans} />}
      {state.status === 'success' && state.plans.length === 0 && (locationActive
        ? <div className="location-empty"><EmptyState titleKey="home.locationEmptyTitle" textKey="home.locationEmptyText" /><div><Link className="button button-secondary" to={`${viewAllUrl || locationUrl || '/plans'}#filters`} state={{ openFilters: true }}>{t('home.changeLocation')}</Link><button className="button button-primary" type="button" onClick={onClearLocation}>{t('home.viewCatalunya')}</button></div></div>
        : <EmptyState />)}
    </div>
  </section>;
}

export function HomePage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const language = i18n.resolvedLanguage?.startsWith('es') ? 'es' : 'ca';
  const [query, setQuery] = useState('');
  const [location, setLocation] = useState(() => readLocationPreference());
  const [weekendPlans, setWeekendPlans] = useState({ status: 'loading', plans: [] });
  const [upcomingPlans, setUpcomingPlans] = useState({ status: 'loading', plans: [] });
  const [permanentPlans, setPermanentPlans] = useState({ status: 'loading', plans: [] });
  const [categories, setCategories] = useState({ status: 'loading', items: [] });
  const [reloadKey, setReloadKey] = useState(0);
  const today = useMemo(() => getQuickDateRange('today'), []);
  const tomorrow = useMemo(() => getQuickDateRange('tomorrow'), []);
  const weekend = useMemo(() => getQuickDateRange('weekend'), []);
  const locationKey = JSON.stringify(location);
  const locationActive = Object.keys(location).length > 0;
  const locationLabel = formatLocationPreference(location);

  useEffect(() => {
    let active = true;
    setWeekendPlans({ status: 'loading', plans: [] });
    setUpcomingPlans({ status: 'loading', plans: [] });
    setPermanentPlans({ status: 'loading', plans: [] });
    setCategories({ status: 'loading', items: [] });
    const common = { ...location, page: 1, sort: 'date', lang: language };
    Promise.allSettled([
      api.getPlans({ ...common, ...weekend, permanent: false, editorial: 'home-weekend', limit: HOME_PLAN_LIMIT }),
      api.getPlans({ ...common, dateFrom: today.date, permanent: false, editorial: 'home-upcoming', limit: HOME_PLAN_LIMIT * 3 }),
      api.getPlans({ ...common, permanent: true, sort: 'quality', limit: 3 }),
      api.getCategories(),
    ]).then(([weekendResult, upcomingResult, permanentResult, categoryResult]) => {
      if (!active) return;
      setWeekendPlans(weekendResult.status === 'fulfilled' ? { status: 'success', plans: weekendResult.value.data.slice(0, HOME_PLAN_LIMIT) } : { status: 'error', plans: [] });
      setUpcomingPlans(upcomingResult.status === 'fulfilled' ? { status: 'success', plans: upcomingResult.value.data } : { status: 'error', plans: [] });
      setPermanentPlans(permanentResult.status === 'fulfilled' ? { status: 'success', plans: permanentResult.value.data.slice(0, 3) } : { status: 'error', plans: [] });
      setCategories(categoryResult.status === 'fulfilled' ? { status: 'success', items: categoryResult.value.data } : { status: 'error', items: [] });
    });
    return () => { active = false; };
  }, [language, locationKey, reloadKey, today.date, weekend.dateFrom, weekend.dateTo]);

  const upcomingWithoutWeekend = useMemo(() => {
    const weekendIds = new Set(weekendPlans.plans.map((plan) => plan.id));
    return { ...upcomingPlans, plans: upcomingPlans.plans.filter((plan) => !weekendIds.has(plan.id)).slice(0, HOME_PLAN_LIMIT) };
  }, [upcomingPlans, weekendPlans.plans]);
  const planUrl = (filters = {}) => {
    const search = createPlansSearch({ ...filters, ...location });
    return search ? `/plans?${search}` : '/plans';
  };
  const todayUrl = planUrl(today);
  const tomorrowUrl = planUrl(tomorrow);
  const weekendUrl = planUrl(weekend);
  const changeLocationUrl = planUrl();
  const clearLocation = () => { clearLocationPreference(); setLocation({}); };
  const retry = () => setReloadKey((value) => value + 1);
  const submit = (event) => {
    event.preventDefault();
    navigate(planUrl({ q: query }));
  };

  return <><Seo title={t('seo.homeTitle')} description={t('seo.homeDescription')} canonicalPath="/" />
    <div className="home-page">
      <section className="home-hero">
        <div className="home-question" aria-hidden="true">?</div>
        <div className="container home-hero-inner">
          <BrandLogo className="home-wordmark" />
          <h1><span className="desktop-hero-title">TENS PLA?</span><span className="mobile-hero-title">{t('home.mobileTitle')}</span></h1>
          <p>{t('home.popClaim')}</p>
          <form className="hero-search" role="search" onSubmit={submit}>
            <label htmlFor="home-search">{t('home.searchLabel')}</label>
            <div><input id="home-search" type="search" maxLength="100" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('home.searchPlaceholder')} /><button type="submit" aria-label={t('filters.search')}>→</button></div>
          </form>
        </div>
      </section>

      <section className="quick-actions-wrap" aria-labelledby="quick-actions-title">
        <h2 id="quick-actions-title" className="sr-only">{t('home.quickActions')}</h2>
        <div className="container quick-actions">
          <QuickAction className="is-today" label={t('filters.today')} to={todayUrl} eyebrow={t('home.quickFilter')} />
          <QuickAction className="is-tomorrow" label={t('filters.tomorrow')} to={tomorrowUrl} eyebrow={t('home.quickFilter')} />
          <QuickAction className="is-weekend" label={t('filters.weekend')} to={weekendUrl} eyebrow={t('home.quickFilter')} />
        </div>
      </section>

      <aside className="home-location" aria-label={t('home.locationContext')}>
        <div className="container"><p><strong>{t('home.showingLocation')}</strong> {locationActive ? locationLabel : t('home.allCatalunya')}</p><div><Link to={`${changeLocationUrl}#filters`} state={{ openFilters: true }}>{t('home.changeLocation')}</Link>{locationActive && <button type="button" onClick={clearLocation}>{t('home.removeLocation')}</button>}</div></div>
      </aside>

      <PlanSection eyebrow={t('home.featured')} title={t('home.weekendTitle')} state={weekendPlans} viewAllUrl={weekendUrl} onRetry={retry} locationActive={locationActive} onClearLocation={clearLocation} />
      <PlanSection eyebrow={t('home.upcomingEyebrow')} title={t('home.upcomingTitle')} state={upcomingWithoutWeekend} viewAllUrl={planUrl({ dateFrom: today.date })} onRetry={retry} locationActive={locationActive} onClearLocation={clearLocation} />

      <section className="home-section explore-section" id="explore">
        <div className="container">
          <header className="explore-heading"><h2>{t('home.exploreTitle')}</h2><p>{t('home.exploreIntro')}</p></header>
          {categories.status === 'loading' && <LoadingState />}
          {categories.status === 'error' && <ErrorState onRetry={retry} />}
          {categories.status === 'success' && categories.items.length === 0 && <EmptyState />}
          {categories.status === 'success' && categories.items.length > 0 && <div className="explore-categories">
            {categories.items.slice(0, 8).map((category, index) => {
              const name = language === 'es' ? (category.name_es || category.name_ca) : (category.name_ca || category.name_es);
              return <Link key={category.slug} data-category={category.slug} to={planUrl({ category: category.slug })}><ExploreCategoryArtwork category={category} eager={index < 4} /><strong>{name}</strong></Link>;
            })}
          </div>}
          <div className="explore-all"><Link className="button button-primary" to={changeLocationUrl}>{t('home.exploreAll')} →</Link></div>
        </div>
      </section>

      <PlanSection eyebrow={t('home.permanentEyebrow')} title={t('home.permanentTitle')} state={permanentPlans} locationUrl={changeLocationUrl} onRetry={retry} locationActive={locationActive} onClearLocation={clearLocation} />
    </div>
  </>;
}
