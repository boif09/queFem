import { Link, Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { TensPlaHorizontalLogo } from '../assets/brand/TensPlaLogos.jsx';
import { Header } from './Header.jsx';

export function Layout() {
  const { t, i18n } = useTranslation();
  const { pathname } = useLocation();
  const spanish = i18n.resolvedLanguage?.startsWith('es');
  const showMobileNav = pathname === '/' || pathname === '/plans';
  return (
    <div className={`site-shell${showMobileNav ? ' has-mobile-nav' : ''}`}>
      <Header />
      <main id="main-content">
        <Outlet />
      </main>
      <footer className="site-footer">
        <div className="container footer-inner">
          <div>
            <TensPlaHorizontalLogo className="footer-logo" />
          </div>
          <div className="footer-meta">
            <nav className="footer-links" aria-label={t('footer.legalNavigation')}>
              <Link to="/legal">{t('footer.legal')}</Link>
              <Link to={spanish ? '/privacidad' : '/privacitat'}>{t('footer.privacy')}</Link>
              <Link to={spanish ? '/almacenamiento' : '/emmagatzematge'}>{t('footer.storage')}</Link>
              <Link to="/fonts">{t('footer.sources')}</Link>
              <Link to={spanish ? '/contacto' : '/contacte'}>{t('footer.contact')}</Link>
            </nav>
            <span>{t('app.tagline')}</span>
            <p>{t('app.notOfficial')}</p>
          </div>
        </div>
      </footer>
      {showMobileNav && (
        <nav className="mobile-nav" aria-label={t('nav.mobile')}>
          <Link to="/"><span aria-hidden="true">⌂</span>{t('nav.home')}</Link>
          <Link to="/plans"><span aria-hidden="true">◇</span>{t('nav.exploreShort')}</Link>
        </nav>
      )}
    </div>
  );
}
