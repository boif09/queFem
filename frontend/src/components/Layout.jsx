import { Link, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Header } from './Header.jsx';
import { BrandLogo } from './BrandLogo.jsx';

export function Layout() {
  const { t, i18n } = useTranslation();
  const spanish = i18n.resolvedLanguage?.startsWith('es');
  return (
    <div className="site-shell">
      <Header />
      <main id="main-content">
        <Outlet />
      </main>
      <footer className="site-footer">
        <div className="container footer-inner">
          <div>
            <BrandLogo className="footer-logo" />
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
    </div>
  );
}
