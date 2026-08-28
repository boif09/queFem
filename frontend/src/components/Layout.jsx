import { Link, Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { TensPlaHorizontalLogo } from '../assets/brand/TensPlaLogos.jsx';
import { Header } from './Header.jsx';

function InstagramIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="17.5" cy="6.5" r="1.2" fill="currentColor" />
    </svg>
  );
}

function TikTokIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M14.5 3c.3 2.6 1.8 4.2 4.5 4.4v3.1a8 8 0 0 1-4.4-1.3v6.5a5.7 5.7 0 1 1-5-5.7v3.2a2.6 2.6 0 1 0 1.8 2.5V3h3.1Z" fill="currentColor" />
    </svg>
  );
}

function SocialLinks({ className = '' }) {
  const { t } = useTranslation();
  return (
    <div className={`social-links ${className}`.trim()}>
      <span className="social-label">{t('footer.followUs')}</span>
      <a href="https://www.instagram.com/tenspla.cat" target="_blank" rel="noopener noreferrer" aria-label={t('footer.instagram')}>
        <InstagramIcon />
      </a>
      <a href="https://www.tiktok.com/@tenspla.cat" target="_blank" rel="noopener noreferrer" aria-label={t('footer.tiktok')}>
        <TikTokIcon />
      </a>
    </div>
  );
}

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
            <SocialLinks className="footer-social-links" />
            <span>{t('app.tagline')}</span>
            <p>{t('app.notOfficial')}</p>
          </div>
        </div>
      </footer>
      {showMobileNav && (
        <nav className="mobile-nav" aria-label={t('nav.mobile')}>
          <SocialLinks className="mobile-social-links" />
          <Link to="/"><span aria-hidden="true">⌂</span>{t('nav.home')}</Link>
          <Link to="/plans"><span aria-hidden="true">◇</span>{t('nav.exploreShort')}</Link>
        </nav>
      )}
    </div>
  );
}
