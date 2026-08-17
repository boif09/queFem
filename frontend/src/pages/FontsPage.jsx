import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState, ErrorState, LoadingState } from '../components/States.jsx';
import { api } from '../services/api.js';
import { formatDate } from '../utils/dates.js';

export function FontsPage() {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage?.startsWith('es') ? 'es' : 'ca';
  const [state, setState] = useState({ status: 'loading', sources: [] });
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    let active = true;
    setState((current) => ({ ...current, status: 'loading' }));
    api.getSources()
      .then((payload) => active && setState({ status: 'success', sources: payload.data }))
      .catch(() => active && setState({ status: 'error', sources: [] }));
    return () => { active = false; };
  }, [reloadKey]);
  return (
    <section className="page-section fonts-page">
      <div className="container narrow-container">
        <header className="page-heading"><p className="eyebrow dark">{t('fonts.eyebrow')}</p><h1>{t('fonts.title')}</h1><p>{t('fonts.intro')}</p></header>
        {state.status === 'loading' && <LoadingState />}
        {state.status === 'error' && <ErrorState titleKey="fonts.error" onRetry={() => setReloadKey((value) => value + 1)} />}
        {state.status === 'success' && state.sources.length === 0 && <EmptyState titleKey="fonts.empty" textKey="fonts.intro" />}
        {state.status === 'success' && state.sources.map((source) => (
          <article className="legal-source-card" key={source.key}>
            <div className="legal-source-top"><span aria-hidden="true">◎</span><div><p>{t('sources.dataset')}</p><h2>{source.name}</h2></div></div>
            <dl>
              <Info label={t('sources.organization')} value={source.publisher} />
              <Info label={t('sources.dataset')} value={source.dataset_name} />
              <Info label={t('sources.license')} value={source.license_name} />
              <Info label={t('sources.attribution')} value={source.attribution_text} />
              <Info label={t('sources.reviewed')} value={source.reviewed_at ? formatDate(source.reviewed_at, language) : null} />
            </dl>
            <div className="legal-links">
              {source.dataset_url && <a href={source.dataset_url} target="_blank" rel="noreferrer">{t('sources.originalLink')} <span aria-hidden="true">↗</span></a>}
              {source.license_url && <a href={source.license_url} target="_blank" rel="noreferrer">{t('sources.licenseLink')} <span aria-hidden="true">↗</span></a>}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function Info({ label, value }) {
  if (!value) return null;
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}
