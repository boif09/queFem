import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Seo } from '../components/Seo.jsx';

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <><Seo title={t('seo.notFoundTitle')} description={t('seo.notFoundDescription')} robots="noindex,follow" />
    <section className="not-found-page page-section">
      <div className="container narrow-container">
        <div className="not-found-graphic" aria-hidden="true"><span>4</span><i>◇</i><span>4</span></div>
        <p className="eyebrow dark">{t('notFound.eyebrow')}</p>
        <h1>{t('notFound.title')}</h1>
        <p>{t('notFound.text')}</p>
        <Link className="button button-primary" to="/">{t('notFound.home')}</Link>
      </div>
    </section></>
  );
}
