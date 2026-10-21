import { useTranslation } from 'react-i18next';
import { trackFavoriteChange } from '../services/analytics.js';
import { useFavorites } from '../utils/favorites.js';
import { uiLanguage } from '../utils/language.js';

function HeartIcon({ filled }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M12 20.5s-7.5-4.6-9.2-9.4C1.6 7.6 3.9 4 7.4 4c2 0 3.6 1.1 4.6 2.7C13 5.1 14.6 4 16.6 4c3.5 0 5.8 3.6 4.6 7.1-1.7 4.8-9.2 9.4-9.2 9.4Z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function FavoriteButton({ plan, placement, showLabel = false, className = '' }) {
  const { t, i18n } = useTranslation();
  const { isFavorite, toggle } = useFavorites();
  const saved = isFavorite(plan.id);
  const label = saved ? t('favorites.remove', { title: plan.title }) : t('favorites.add', { title: plan.title });
  const onClick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    const nowSaved = toggle(plan);
    if (nowSaved !== null) trackFavoriteChange({ planId: plan.id, saved: nowSaved, placement, language: uiLanguage(i18n) });
  };
  return (
    <button
      type="button"
      className={`favorite-button${saved ? ' is-saved' : ''}${showLabel ? ' has-label' : ''} ${className}`.trim()}
      aria-pressed={saved}
      aria-label={showLabel ? undefined : label}
      title={label}
      onClick={onClick}
    >
      <HeartIcon filled={saved} />
      {showLabel && <span>{saved ? t('favorites.savedLabel') : t('favorites.saveLabel')}</span>}
    </button>
  );
}
