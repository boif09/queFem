import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { formatDate } from '../utils/dates.js';
import { PlanVisual } from './PlanVisual.jsx';

export function PlanCard({ plan }) {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const language = i18n.resolvedLanguage?.startsWith('es') ? 'es' : 'ca';
  const primaryCategory = plan.categories?.[0];
  const dateLabel = plan.permanent
    ? t('plan.permanent')
    : !plan.end_date || plan.start_date === plan.end_date
      ? formatDate(plan.start_date, language)
      : t('date.range', { start: formatDate(plan.start_date, language), end: formatDate(plan.end_date, language) });
  const price = plan.free ? t('plan.free') : (plan.price_text || t('plan.priceUnknown'));
  const place = [plan.municipality, plan.comarca].filter(Boolean).join(' · ') || t('plan.locationUnknown');
  return (
    <article className="plan-card">
      <Link
        className="plan-card-link"
        to={`/plans/${plan.id}`}
        state={{ from: `${location.pathname}${location.search}` }}
        aria-label={t('plan.openDetail', { title: plan.title })}
      >
        <PlanVisual plan={plan} showKind />
        <div className="plan-card-body">
          {primaryCategory && <span className="category-label">{primaryCategory.name}</span>}
          <h2>{plan.title}</h2>
          <dl className="card-meta">
            <div><dt aria-hidden="true">◷</dt><dd>{dateLabel}</dd></div>
            <div><dt aria-hidden="true">⌖</dt><dd>{place}</dd></div>
          </dl>
          <div className="card-footer">
            <span className={plan.free ? 'price-tag is-free' : 'price-tag'}>{price}</span>
            <span className="card-arrow" aria-hidden="true">↗</span>
          </div>
        </div>
      </Link>
    </article>
  );
}
