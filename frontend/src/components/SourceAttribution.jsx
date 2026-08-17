import { useTranslation } from 'react-i18next';
import { formatDate } from '../utils/dates.js';

export function SourceAttribution({ sources }) {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage?.startsWith('es') ? 'es' : 'ca';
  if (!sources?.length) return null;
  return (
    <section className="source-section" aria-labelledby="source-heading">
      <div className="source-heading">
        <span aria-hidden="true">◎</span>
        <div><p>{t('sources.attribution')}</p><h2 id="source-heading">{t('sources.sectionTitle')}</h2></div>
      </div>
      <div className="source-list">
        {sources.map((source, index) => (
          <article className="source-card" key={`${source.name}-${source.source_url || 'no-url'}-${index}`}>
            <h3>{source.name}</h3>
            {source.publisher && <p><strong>{t('sources.organization')}</strong><span>{source.publisher}</span></p>}
            {source.attribution_text && <p><strong>{t('sources.attribution')}</strong><span>{source.attribution_text}</span></p>}
            {source.source_updated_at && <p><strong>{t('sources.updated')}</strong><span>{formatDate(source.source_updated_at.slice(0, 10), language)}</span></p>}
            {source.source_url && <a href={source.source_url} target="_blank" rel="noreferrer">{t('sources.originalLink')} <span aria-hidden="true">↗</span></a>}
          </article>
        ))}
      </div>
    </section>
  );
}
