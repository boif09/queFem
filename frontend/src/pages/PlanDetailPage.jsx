import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CategoryIcon } from '../components/CategoryIcon.jsx';
import { SourceAttribution } from '../components/SourceAttribution.jsx';
import { ErrorState, LoadingState } from '../components/States.jsx';
import { api } from '../services/api.js';
import { formatDate } from '../utils/dates.js';

function InfoItem({ label, children }) {
  if (children === null || children === undefined || children === '') return null;
  return <div className="info-item"><dt>{label}</dt><dd>{children}</dd></div>;
}

export function PlanDetailPage() {
  const { id } = useParams();
  const location = useLocation();
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage?.startsWith('es') ? 'es' : 'ca';
  const [state, setState] = useState({ status: 'loading', plan: null });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setState({ status: 'loading', plan: null });
    api.getPlan(id, language)
      .then((payload) => active && setState({ status: 'success', plan: payload.data }))
      .catch((error) => active && setState({ status: error.status === 404 ? 'not-found' : 'error', plan: null }));
    return () => { active = false; };
  }, [id, language, reloadKey]);

  if (state.status === 'loading') return <section className="page-section"><div className="container"><LoadingState /></div></section>;
  if (state.status === 'error') return <section className="page-section"><div className="container"><ErrorState titleKey="detail.errorTitle" onRetry={() => setReloadKey((value) => value + 1)} /></div></section>;
  if (state.status === 'not-found') return <section className="page-section"><div className="container"><ErrorState titleKey="detail.errorTitle" textKey="detail.notFound" /></div></section>;

  const plan = state.plan;
  const primaryCategory = plan.categories?.[0];
  const date = plan.permanent
    ? t('plan.permanent')
    : !plan.end_date || plan.start_date === plan.end_date
      ? formatDate(plan.start_date, language)
      : t('date.range', { start: formatDate(plan.start_date, language), end: formatDate(plan.end_date, language) });
  const price = plan.free ? t('plan.free') : (plan.price_text || t('plan.priceUnknown'));
  const back = location.state?.from || '/plans';

  return (
    <article className="detail-page">
      <div className="detail-hero" data-category={primaryCategory?.slug || plan.kind}>
        <div className="container">
          <Link className="back-link" to={back}>← {t('detail.back')}</Link>
          <div className="detail-title-row">
            <CategoryIcon icon={primaryCategory?.icon} className="detail-icon" />
            <div>
              <div className="detail-labels">
                {primaryCategory && <span>{primaryCategory.name}</span>}
                <span>{t(`plan.kind.${plan.kind}`)}</span>
              </div>
              <h1>{plan.title}</h1>
              {plan.subtitle && <p className="detail-subtitle">{plan.subtitle}</p>}
            </div>
          </div>
        </div>
      </div>
      <div className="container detail-layout">
        <div className="detail-main">
          {plan.description && <section className="content-section"><p className="section-kicker">{t('detail.about')}</p><div className="prose">{plan.description}</div></section>}
          <SourceAttribution sources={plan.sources} />
        </div>
        <aside className="practical-card">
          <h2>{t('detail.practical')}</h2>
          <dl>
            <InfoItem label={t('detail.date')}>{date}</InfoItem>
            <InfoItem label={t('detail.schedule')}>{plan.schedule_text}</InfoItem>
            <InfoItem label={t('detail.price')}>{price}</InfoItem>
            <InfoItem label={t('detail.venue')}>{plan.venue_name}</InfoItem>
            <InfoItem label={t('detail.address')}>{plan.address}</InfoItem>
            <InfoItem label={t('detail.municipality')}>{plan.municipality}</InfoItem>
            <InfoItem label={t('detail.comarca')}>{plan.comarca}</InfoItem>
            <InfoItem label={t('detail.locality')}>{plan.locality}</InfoItem>
            {plan.latitude !== null && plan.longitude !== null && (
              <InfoItem label={t('detail.coordinates')}>
                <span>{plan.latitude}, {plan.longitude}</span>
                <small>{t('detail.mapFuture')}</small>
              </InfoItem>
            )}
          </dl>
          <div className="official-links">
            {plan.website_url && <a className="button button-primary" href={plan.website_url} target="_blank" rel="noreferrer">{t('detail.officialWeb')} <span aria-hidden="true">↗</span></a>}
            {plan.ticket_url && <a className="button button-secondary" href={plan.ticket_url} target="_blank" rel="noreferrer">{t('detail.tickets')} <span aria-hidden="true">↗</span></a>}
          </div>
        </aside>
      </div>
    </article>
  );
}
