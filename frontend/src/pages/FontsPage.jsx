import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState, ErrorState, LoadingState } from '../components/States.jsx';
import { Seo } from '../components/Seo.jsx';
import { api } from '../services/api.js';
import { formatDate } from '../utils/dates.js';

// Several registered sources can belong to the same organisation under the same licence and attribution (the three
// Diputació de Barcelona datasets). They are one entry on this page, listing each dataset with its own link.
export function groupSources(sources) {
  const groups = new Map();
  for (const source of sources) {
    const key = JSON.stringify([source.name, source.publisher, source.license_name, source.license_url, source.attribution_text]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(source);
  }
  return [...groups.values()];
}

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
    <><Seo title={t('seo.fontsTitle')} description={t('seo.fontsDescription')} canonicalPath="/fonts" />
    <section className="page-section fonts-page">
      <div className="container narrow-container">
        <header className="page-heading"><p className="eyebrow dark">{t('fonts.eyebrow')}</p><h1>{t('fonts.title')}</h1><p>{t('fonts.intro')}</p><p>{t('fonts.independence')}</p></header>
        {state.status === 'loading' && <LoadingState />}
        {state.status === 'error' && <ErrorState titleKey="fonts.error" onRetry={() => setReloadKey((value) => value + 1)} />}
        {state.status === 'success' && state.sources.length === 0 && <EmptyState titleKey="fonts.empty" textKey="fonts.intro" />}
        <div className="source-registry">
        {state.status === 'success' && groupSources(state.sources).map((group) => (
          <SourceCard key={group.map(({ key }) => key).join('+')} group={group} language={language} t={t} />
        ))}
        <article className="legal-source-card"><h2>Institut Cartogràfic i Geològic de Catalunya (ICGC)</h2><p>{t('fonts.icgc')}</p><div className="legal-links"><a href="https://www.icgc.cat/ca/Descarregues/Cartografia-vectorial/Divisions-administratives" target="_blank" rel="noreferrer">Divisions administratives ↗</a><a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0 ↗</a></div></article>
        </div>
        <p className="source-corrections">{t('fonts.corrections')} <a href="mailto:contacte@tenspla.cat">contacte@tenspla.cat</a></p>
      </div>
    </section></>
  );
}

function SourceCard({ group, language, t }) {
  const [source] = group;
  const grouped = group.length > 1;
  // The latest review date of the datasets that share this entry.
  const reviewed = group.map(({ reviewed_at: date }) => date).filter(Boolean).sort().at(-1) ?? null;
  return (
    <article className="legal-source-card">
      <div className="legal-source-top"><span aria-hidden="true">◎</span><div><p>{t(grouped ? 'sources.datasets' : 'sources.dataset')}</p><h2>{source.name}</h2></div></div>
      <dl>
        <Info label={t('sources.organization')} value={source.publisher} />
        {grouped
          ? (
            <div>
              <dt>{t('sources.datasets')}</dt>
              <dd>
                <ul className="source-datasets">
                  {group.map((item) => (
                    <li key={item.key}>
                      <span>{item.dataset_name}</span>
                      {item.dataset_url && <a href={item.dataset_url} target="_blank" rel="noreferrer">{t('sources.originalLink')} <span aria-hidden="true">↗</span></a>}
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          )
          : <Info label={t('sources.dataset')} value={source.dataset_name} />}
        <Info label={t('sources.license')} value={source.license_name} />
        <Info label={t('sources.attribution')} value={source.attribution_text} />
        <Info label={t('sources.reviewed')} value={reviewed ? formatDate(reviewed, language) : null} />
      </dl>
      <div className="legal-links">
        {!grouped && source.dataset_url && <a href={source.dataset_url} target="_blank" rel="noreferrer">{t('sources.originalLink')} <span aria-hidden="true">↗</span></a>}
        {source.license_url && <a href={source.license_url} target="_blank" rel="noreferrer">{t('sources.licenseLink')} <span aria-hidden="true">↗</span></a>}
      </div>
      {source.key === 'ticketmaster-discovery-feed' && <p className="source-policy-note">{t('fonts.ticketmaster')}</p>}
      {source.key === 'fever' && <p className="source-policy-note">{t('fonts.fever')}</p>}
    </article>
  );
}

function Info({ label, value }) {
  if (!value) return null;
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}
