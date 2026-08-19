import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { BrandLogo } from '../components/BrandLogo.jsx';
import { CategoryIcon } from '../components/CategoryIcon.jsx';
import { PlanList } from '../components/PlanList.jsx';
import { EmptyState, ErrorState, LoadingState } from '../components/States.jsx';
import { api } from '../services/api.js';
import { getQuickDateRange, toISODate } from '../utils/dates.js';
import { createPlansSearch } from '../utils/search.js';

function QuickAction({ className, label, to, eyebrow, state }) {
  return <Link className={`quick-action ${className}`} to={to} state={state}><small>{eyebrow}</small><strong>{label}</strong><span aria-hidden="true">↗</span></Link>;
}

export function HomePage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const language = i18n.resolvedLanguage?.startsWith('es') ? 'es' : 'ca';
  const [query, setQuery] = useState('');
  const [today, setToday] = useState({ status: 'loading', plans: [] });
  const [categories, setCategories] = useState({ status: 'loading', items: [] });
  const todayIso = useMemo(() => toISODate(new Date()), []);
  const weekend = getQuickDateRange('weekend');

  useEffect(() => {
    let active = true;
    Promise.all([
      api.getPlans({ date: todayIso, kind: 'event', page: 1, limit: 3, sort: 'date', lang: language }),
      api.getCategories(),
    ]).then(([plansPayload, categoryPayload]) => {
      if (!active) return;
      setToday({ status: 'success', plans: plansPayload.data });
      setCategories({ status: 'success', items: categoryPayload.data });
    }).catch(() => {
      if (!active) return;
      setToday({ status: 'error', plans: [] });
      setCategories({ status: 'error', items: [] });
    });
    return () => { active = false; };
  }, [language, todayIso]);

  const submit = (event) => {
    event.preventDefault();
    const search = createPlansSearch({ q: query });
    navigate(search ? `/plans?${search}` : '/plans');
  };
  const todayUrl = `/plans?${createPlansSearch({ date: todayIso })}`;
  const weekendUrl = `/plans?${createPlansSearch(weekend)}`;

  return (
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
          <QuickAction className="is-weekend" label={t('home.weekendShort')} to={weekendUrl} eyebrow={t('home.quickFilter')} />
          <QuickAction className="is-free" label={t('home.freeShort')} to="/plans?free=true" eyebrow={t('home.quickFilter')} />
          <QuickAction className="is-near" label={t('home.near')} to="/plans#filters" state={{ openFilters: true }} eyebrow={t('home.quickFilter')} />
        </div>
      </section>

      <section className="home-section today-section">
        <div className="container">
          <header className="section-title-row"><div><p>{t('home.featured')}</p><h2>{t('home.todayTitle')}</h2></div><Link to={todayUrl}>{t('home.viewAll')} →</Link></header>
          {today.status === 'loading' && <LoadingState />}
          {today.status === 'error' && <ErrorState />}
          {today.status === 'success' && today.plans.length === 0 && <EmptyState />}
          {today.status === 'success' && today.plans.length > 0 && <PlanList plans={today.plans} />}
        </div>
      </section>

      <section className="home-section explore-section" id="explore">
        <div className="container">
          <header className="explore-heading"><h2>{t('home.exploreTitle')}</h2><p>{t('home.exploreIntro')}</p></header>
          {categories.status === 'loading' && <LoadingState />}
          {categories.status === 'error' && <ErrorState />}
          {categories.status === 'success' && (
            <div className="explore-categories">
              {categories.items.slice(0, 8).map((category) => {
                const name = language === 'es' ? (category.name_es || category.name_ca) : (category.name_ca || category.name_es);
                return (
                  <Link key={category.slug} data-category={category.slug} to={`/plans?category=${encodeURIComponent(category.slug)}`}>
                    <span className="explore-category-artwork" aria-hidden="true"><i /><i /><CategoryIcon icon={category.icon} /></span>
                    <strong>{name}</strong>
                  </Link>
                );
              })}
            </div>
          )}
          <div className="explore-all"><Link className="button button-primary" to="/plans">{t('home.exploreAll')} →</Link></div>
        </div>
      </section>
    </div>
  );
}
