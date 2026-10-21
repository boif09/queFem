import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PlanCard } from '../components/PlanCard.jsx';
import { Seo } from '../components/Seo.jsx';
import { LoadingState } from '../components/States.jsx';
import { api } from '../services/api.js';
import { removeFavorite, replaceFavoriteId, useFavorites } from '../utils/favorites.js';
import { contentLanguage, uiLanguage } from '../utils/language.js';

const CONCURRENCY = 4;

async function loadPlans(ids, language, onResult) {
  const queue = [...ids];
  const worker = async () => {
    while (queue.length > 0) {
      const id = queue.shift();
      try {
        const payload = await api.getPlan(id, language);
        onResult(id, { status: 'ready', plan: payload.data });
      } catch (error) {
        onResult(id, { status: error.status === 404 ? 'gone' : 'error' });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ids.length) }, worker));
}

// Favourites live only on this device; each one is refreshed from the API so dates and prices are current.
export function FavoritesPage() {
  const { t, i18n } = useTranslation();
  const language = contentLanguage(uiLanguage(i18n));
  const { items } = useFavorites();
  const [state, setState] = useState({ language, results: {} });
  const inFlight = useRef(new Set());
  const currentLanguage = useRef(language);
  currentLanguage.current = language;
  const results = state.language === language ? state.results : {};

  useEffect(() => {
    const ids = items.map((item) => item.id).filter((id) => !results[id] && !inFlight.current.has(`${language}:${id}`));
    if (ids.length === 0) return;
    ids.forEach((id) => inFlight.current.add(`${language}:${id}`));
    loadPlans(ids, language, (id, result) => {
      inFlight.current.delete(`${language}:${id}`);
      if (currentLanguage.current !== language) return;
      const canonicalId = result.status === 'ready' ? String(result.plan.id) : id;
      setState((current) => ({
        language,
        results: { ...(current.language === language ? current.results : {}), [canonicalId]: result },
      }));
      if (canonicalId !== id) replaceFavoriteId(id, result.plan);
    });
  }, [items, results, language]);

  // Forget plans that are no longer saved, so saving one again reloads it.
  useEffect(() => {
    const saved = new Set(items.map((item) => item.id));
    if (Object.keys(state.results).every((id) => saved.has(id))) return;
    setState((current) => ({
      ...current,
      results: Object.fromEntries(Object.entries(current.results).filter(([id]) => saved.has(id))),
    }));
  }, [items, state.results]);

  const entries = items.map((item) => ({ item, result: results[item.id] }));
  const ready = entries.filter(({ result }) => result?.status === 'ready');
  const gone = entries.filter(({ result }) => result?.status === 'gone');
  const failed = entries.filter(({ result }) => result?.status === 'error');
  const loading = entries.some(({ result }) => !result);
  const retry = () => setState((current) => ({
    ...current,
    results: Object.fromEntries(Object.entries(current.results).filter(([, result]) => result.status !== 'error')),
  }));

  return (
    <><Seo title={`${t('favorites.title')} | Tens pla?`} description={t('favorites.intro')} robots="noindex,follow" />
    <section className="page-section favorites-page">
      <div className="container">
        <header className="page-heading">
          <p className="eyebrow dark">{t('favorites.eyebrow')}</p>
          <h1>{t('favorites.title')}</h1>
          <p>{t('favorites.intro')}</p>
        </header>
        {items.length === 0 && (
          <div className="state-card empty-state">
            <span aria-hidden="true">♡</span>
            <h2>{t('favorites.emptyTitle')}</h2>
            <p>{t('favorites.emptyText')}</p>
            <Link className="button button-primary" to="/plans">{t('favorites.explore')}</Link>
          </div>
        )}
        {ready.length > 0 && <div className="plan-grid">{ready.map(({ result }) => <PlanCard key={result.plan.id} plan={result.plan} />)}</div>}
        {loading && <LoadingState />}
        {failed.length > 0 && (
          <div className="state-card error-state" role="alert">
            <span aria-hidden="true">!</span>
            <h2>{t('favorites.errorTitle')}</h2>
            <p>{t('favorites.errorText', { count: failed.length })}</p>
            <button type="button" className="button button-secondary" onClick={retry}>{t('state.retry')}</button>
          </div>
        )}
        {gone.length > 0 && (
          <section className="favorites-gone" aria-labelledby="favorites-gone-title">
            <h2 id="favorites-gone-title">{t('favorites.goneTitle')}</h2>
            <p>{t('favorites.goneText')}</p>
            <ul>
              {gone.map(({ item }) => (
                <li key={item.id}>
                  <span>{item.title || t('favorites.untitled')}</span>
                  <button type="button" className="button button-secondary" onClick={() => removeFavorite(item.id)}>
                    {t('favorites.removeGone')}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </section></>
  );
}
