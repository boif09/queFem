import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CategoryIcon } from './CategoryIcon.jsx';

export function PlanVisual({
  plan,
  className = '',
  showKind = false,
  showAttribution = false,
  loading = 'eager',
  onImageError,
}) {
  const { t } = useTranslation();
  const primaryCategory = plan.categories?.[0];
  const category = primaryCategory?.slug || plan.kind;
  const image = plan.image?.url ? plan.image : null;
  // Remember which URL failed instead of resetting a flag in an effect: an error that fires before
  // the mount effect runs would otherwise be overwritten and leave a broken image on screen.
  const [failedUrl, setFailedUrl] = useState(null);
  const canShowImage = Boolean(image?.url) && failedUrl !== image.url;
  const handleImageError = () => {
    setFailedUrl(image.url);
    onImageError?.(image.url);
  };

  const visual = (
    <div className={`plan-visual${canShowImage ? ' has-image' : ''}${className ? ` ${className}` : ''}`} data-category={category}>
      {canShowImage ? (
        <img
          src={image.url}
          alt={image.alt || ''}
          width={image.width}
          height={image.height}
          loading={loading}
          decoding="async"
          onError={handleImageError}
        />
      ) : (
        <div className="category-artwork" data-pattern={category} aria-hidden="true">
          <i /><i /><i /><i />
          <CategoryIcon icon={primaryCategory?.icon} className="category-icon-large" />
        </div>
      )}
      {showKind && <span className="kind-label">{t(`plan.kind.${plan.kind}`)}</span>}
    </div>
  );

  if (!showAttribution) return visual;
  return (
    <div className="plan-card-visual">
      {visual}
      {canShowImage && image.source !== 'gencat' && image.attribution ? (
        <span className="card-image-attribution">{image.attribution}</span>
      ) : null}
    </div>
  );
}
