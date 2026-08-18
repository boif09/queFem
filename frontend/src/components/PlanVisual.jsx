import { useTranslation } from 'react-i18next';
import { CategoryIcon } from './CategoryIcon.jsx';

export function PlanVisual({ plan, className = '', showKind = false }) {
  const { t } = useTranslation();
  const primaryCategory = plan.categories?.[0];
  const category = primaryCategory?.slug || plan.kind;
  const canShowImage = plan.image_reuse_allowed === true && Boolean(plan.image_url);

  return (
    <div className={`plan-visual${className ? ` ${className}` : ''}`} data-category={category}>
      {canShowImage ? (
        <img src={plan.image_url} alt="" loading="lazy" />
      ) : (
        <div className="category-artwork" aria-hidden="true">
          <i /><i /><i />
          <CategoryIcon icon={primaryCategory?.icon} className="category-icon-large" />
        </div>
      )}
      {showKind && <span className="kind-label">{t(`plan.kind.${plan.kind}`)}</span>}
    </div>
  );
}
