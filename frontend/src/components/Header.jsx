import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LanguageSwitcher } from './LanguageSwitcher.jsx';
import { TensPlaHorizontalLogo } from '../assets/brand/TensPlaLogos.jsx';
import { useFavorites } from '../utils/favorites.js';
import { favoritesPath } from '../utils/favoritesPath.js';
import { uiLanguage } from '../utils/language.js';

function FavoritesLink() {
  const { t, i18n } = useTranslation();
  const { items } = useFavorites();
  const count = items.length;
  return (
    <NavLink
      className={({ isActive }) => `favorites-link${isActive ? ' is-active' : ''}`}
      to={favoritesPath(uiLanguage(i18n))}
      aria-label={count > 0 ? t('favorites.linkWithCount', { count }) : t('favorites.title')}
      title={t('favorites.title')}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M12 20.5s-7.5-4.6-9.2-9.4C1.6 7.6 3.9 4 7.4 4c2 0 3.6 1.1 4.6 2.7C13 5.1 14.6 4 16.6 4c3.5 0 5.8 3.6 4.6 7.1-1.7 4.8-9.2 9.4-9.2 9.4Z" fill={count > 0 ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      </svg>
      {count > 0 && <span className="favorites-count" aria-hidden="true">{count > 99 ? '99+' : count}</span>}
    </NavLink>
  );
}

export function Header() {
  const { t } = useTranslation();
  const navClass = ({ isActive }) => `nav-link${isActive ? ' is-active' : ''}`;
  return (
    <header className="site-header">
      <div className="container header-inner">
        <NavLink className="brand" to="/" aria-label={t('nav.home')}>
          <TensPlaHorizontalLogo className="header-brand-logo" />
        </NavLink>
        <nav className="primary-nav" aria-label={t('nav.explore')}>
          <NavLink className={navClass} to="/">{t('nav.home')}</NavLink>
          <NavLink className={navClass} to="/avui">{t('nav.today')}</NavLink>
          <NavLink className={navClass} to="/cap-de-setmana">{t('nav.weekend')}</NavLink>
          <NavLink className={navClass} to="/plans">{t('nav.explore')}</NavLink>
          <NavLink className={navClass} to="/widget">{t('nav.widget')}</NavLink>
        </nav>
        <FavoritesLink />
        <LanguageSwitcher />
      </div>
    </header>
  );
}
