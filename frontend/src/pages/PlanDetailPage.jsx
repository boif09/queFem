import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CategoryIcon } from '../components/CategoryIcon.jsx';
import { PlanVisual } from '../components/PlanVisual.jsx';
import { hasValidCoordinates, MiniMap } from '../components/MiniMap.jsx';
import { SourceAttribution } from '../components/SourceAttribution.jsx';
import { PUBLIC_ORIGIN, Seo } from '../components/Seo.jsx';
import { ErrorState, LoadingState } from '../components/States.jsx';
import { api } from '../services/api.js';
import { formatDate } from '../utils/dates.js';

function InfoItem({ label, children }) {
  if (children === null || children === undefined || children === '') return null;
  return <div className="info-item"><dt>{label}</dt><dd>{children}</dd></div>;
}

function compactDescription(value, limit = 160) {
  const compact = value?.replace(/\s+/g, ' ').trim();
  if (!compact || compact.length <= limit) return compact || '';
  const shortened = compact.slice(0, limit - 1);
  return `${shortened.slice(0, shortened.lastIndexOf(' ')) || shortened}…`;
}

export function buildEventJsonLd(plan, url, description) {
  const occurrenceDate = plan.nextOccurrence?.localDate;
  const hasOccurrence = /^\d{4}-\d{2}-\d{2}$/.test(occurrenceDate || '');
  const hasStartDate = hasOccurrence || /^\d{4}-\d{2}-\d{2}$/.test(plan.start_date || '');
  const hasCoordinates = hasValidCoordinates(plan.latitude, plan.longitude);
  const address = [plan.address, plan.postal_code, plan.locality, plan.municipality, plan.province]
    .filter(Boolean).join(', ');
  const hasNamedPlace = Boolean(plan.venue_name || plan.address);
  const hasGeographicContext = Boolean(address || hasCoordinates);
  if (!plan.title?.trim() || !hasStartDate || !hasNamedPlace || !hasGeographicContext) return null;

  const event = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: plan.title,
    url,
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    eventStatus: 'https://schema.org/EventScheduled',
  };
  if (hasOccurrence) {
    event.startDate = plan.nextOccurrence.localTime
      ? `${occurrenceDate}T${plan.nextOccurrence.localTime}:00`
      : occurrenceDate;
  } else {
    event.startDate = plan.start_date;
    if (/^\d{4}-\d{2}-\d{2}$/.test(plan.end_date || '')) event.endDate = plan.end_date;
  }
  if (description) event.description = description;

  event.location = {
    '@type': 'Place',
    name: plan.venue_name || plan.address,
  };
  if (address) event.location.address = address;
  if (hasCoordinates) {
    event.location.geo = {
      '@type': 'GeoCoordinates',
      latitude: Number(plan.latitude),
      longitude: Number(plan.longitude),
    };
  }
  return event;
}

export function PlanDetailPage() {
  const { id } = useParams();
  const location = useLocation();
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage?.startsWith('es') ? 'es' : 'ca';
  const [state, setState] = useState({ status: 'loading', plan: null });
  const [reloadKey, setReloadKey] = useState(0);
  const [detailImageFailed, setDetailImageFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setState({ status: 'loading', plan: null });
    api.getPlan(id, language)
      .then((payload) => active && setState({ status: 'success', plan: payload.data }))
      .catch((error) => active && setState({ status: error.status === 404 ? 'not-found' : 'error', plan: null }));
    return () => { active = false; };
  }, [id, language, reloadKey]);

  useEffect(() => setDetailImageFailed(false), [id, state.plan?.image?.url]);

  if (state.status === 'loading') return <><Seo title={t('seo.detailLoadingTitle')} description={t('seo.notFoundDescription')} robots="noindex,follow" /><section className="page-section"><div className="container"><LoadingState /></div></section></>;
  if (state.status === 'error') return <><Seo title={`${t('detail.errorTitle')} | Tens pla?`} description={t('detail.notFound')} robots="noindex,follow" /><section className="page-section"><div className="container"><ErrorState titleKey="detail.errorTitle" onRetry={() => setReloadKey((value) => value + 1)} /></div></section></>;
  if (state.status === 'not-found') return <><Seo title={t('seo.notFoundTitle')} description={t('detail.notFound')} robots="noindex,follow" /><section className="page-section"><div className="container"><ErrorState titleKey="detail.errorTitle" textKey="detail.notFound" /></div></section></>;

  const plan = state.plan;
  const primaryCategory = plan.categories?.[0];
  const occurrenceDate = plan.nextOccurrence && `${formatDate(plan.nextOccurrence.localDate, language)}${plan.nextOccurrence.localTime ? ` · ${plan.nextOccurrence.localTime}` : ''}`;
  const date = occurrenceDate || (plan.permanent
    ? t('plan.permanent')
    : !plan.end_date || plan.start_date === plan.end_date
      ? formatDate(plan.start_date, language)
      : t('date.range', { start: formatDate(plan.start_date, language), end: formatDate(plan.end_date, language) }));
  const commercePrice = plan.commerce?.price;
  const price = commercePrice?.type === 'free' ? t('plan.free') : commercePrice?.type === 'from'
    ? t('plan.priceFrom', { amount: commercePrice.amount }) : commercePrice?.type === 'fixed'
      ? t('plan.priceFixed', { amount: commercePrice.amount }) : plan.commerce ? t('plan.priceProvider')
        : plan.free ? t('plan.free') : (plan.price_text || t('plan.priceUnknown'));
  const back = location.state?.from || '/plans';
  const hasCoordinates = hasValidCoordinates(plan.latitude, plan.longitude);
  const locationLabel = plan.municipality ? `${language === 'es' ? ' en ' : ' a '}${plan.municipality}` : '';
  const seoTitle = `${plan.title}${locationLabel} | Tens pla?`;
  const seoDescription = compactDescription(plan.description)
    || t('seo.detailFallback', { title: plan.title, location: locationLabel });
  const canonicalPath = `/plans/${encodeURIComponent(plan.id)}`;
  const canonicalUrl = `${PUBLIC_ORIGIN}${canonicalPath}`;
  const indexableEvent = plan.kind === 'event';
  const jsonLd = indexableEvent ? buildEventJsonLd(plan, canonicalUrl, seoDescription) : null;

  return (
    <><Seo
      title={seoTitle}
      description={seoDescription}
      canonicalPath={indexableEvent ? canonicalPath : null}
      robots={indexableEvent ? 'index,follow' : 'noindex,follow'}
      jsonLd={jsonLd}
    />
    <article className="detail-page">
      <div className="container detail-header">
        <Link className="back-link" to={back}>← {t('detail.back')}</Link>
        <figure className="detail-media">
          <PlanVisual
            plan={plan}
            className="detail-visual"
            onImageError={() => setDetailImageFailed(true)}
          />
          {plan.image?.attribution && !detailImageFailed && (
            <figcaption className="image-attribution">{plan.image.attribution}</figcaption>
          )}
        </figure>
      </div>
      <div className="detail-hero" data-category={primaryCategory?.slug || plan.kind}>
        <div className="container">
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
          {plan.nextOccurrences?.length > 0 && <section className="content-section"><p className="section-kicker">{t('detail.nextDates')}</p><ul>{plan.nextOccurrences.map((occurrence, index) => <li key={`${occurrence.localDate}-${occurrence.localTime}-${index}`}>{formatDate(occurrence.localDate, language)}{occurrence.localTime ? ` · ${occurrence.localTime}` : ''}</li>)}</ul>{plan.hasMoreOccurrences && <p>{t('detail.moreDates')}</p>}</section>}
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
            {hasCoordinates && (
              <InfoItem label={t('detail.coordinates')}>
                <span className="coordinate-value">{plan.latitude}, {plan.longitude}</span>
                <MiniMap latitude={plan.latitude} longitude={plan.longitude} />
              </InfoItem>
            )}
          </dl>
          <div className="official-links">
            {plan.commerce?.provider === 'fever' && <><a className="button button-primary" href={plan.commerce.affiliateUrl} target="_blank" rel="noopener noreferrer">{t('detail.feverTickets')} <span aria-hidden="true">↗</span></a><p className="affiliate-disclosure">{t('detail.affiliateDisclosure')}</p></>}
            {plan.website_url && <a className="button button-primary" href={plan.website_url} target="_blank" rel="noreferrer">{t('detail.officialWeb')} <span aria-hidden="true">↗</span></a>}
            {plan.ticket_url && <a className="button button-secondary" href={plan.ticket_url} target="_blank" rel="noreferrer">{t('detail.tickets')} <span aria-hidden="true">↗</span></a>}
          </div>
        </aside>
      </div>
    </article></>
  );
}
