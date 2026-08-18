import { Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Header } from './Header.jsx';
import { BrandLogo } from './BrandLogo.jsx';

export function Layout() {
  const { t } = useTranslation();
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
            <span>{t('app.tagline')}</span>
            <p>{t('app.notOfficial')}</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
