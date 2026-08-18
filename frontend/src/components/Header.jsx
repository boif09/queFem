import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LanguageSwitcher } from './LanguageSwitcher.jsx';
import { BrandLogo } from './BrandLogo.jsx';

export function Header() {
  const { t } = useTranslation();
  const navClass = ({ isActive }) => `nav-link${isActive ? ' is-active' : ''}`;
  return (
    <header className="site-header">
      <div className="container header-inner">
        <NavLink className="brand" to="/" aria-label={t('nav.home')}>
          <BrandLogo />
        </NavLink>
        <nav className="primary-nav" aria-label={t('nav.explore')}>
          <NavLink className={navClass} to="/">{t('nav.home')}</NavLink>
          <NavLink className={navClass} to="/plans">{t('nav.explore')}</NavLink>
          <NavLink className={navClass} to="/fonts">{t('nav.sources')}</NavLink>
        </nav>
        <LanguageSwitcher />
      </div>
    </header>
  );
}
