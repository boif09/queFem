import { Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Header } from './Header.jsx';

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
            <strong>{t('app.name')}</strong>
            <span>{t('app.tagline')}</span>
          </div>
          <p>{t('app.notOfficial')}</p>
        </div>
      </footer>
    </div>
  );
}
