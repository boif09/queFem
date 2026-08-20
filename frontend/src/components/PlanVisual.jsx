import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CategoryIcon } from './CategoryIcon.jsx';

export function PlanVisual({
  plan,
  className = '',
  showKind = false,
  loading = 'eager',
  onImageError,
}) {
  const { t } = useTranslation();
  const primaryCategory = plan.categories?.[0];
  const category = primaryCategory?.slug || plan.kind;
  const controlledImage = plan.image?.url ? plan.image : null;
  const legacyImage = plan.image_reuse_allowed === true && plan.image_url
    ? { url: plan.image_url }
    : null;
  const image = controlledImage || legacyImage;
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => setImageFailed(false), [image?.url]);

  const canShowImage = Boolean(image?.url) && !imageFailed;
  const handleImageError = () => {
    setImageFailed(true);
    onImageError?.();
  };

  return (
    <div className={`plan-visual${canShowImage ? ' has-image' : ''}${className ? ` ${className}` : ''}`} data-category={category}>
      {canShowImage ? (
        <img
          src={image.url}
          alt=""
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
}
