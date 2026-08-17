import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export function Pagination({ pagination }) {
  const { t } = useTranslation();
  const location = useLocation();
  if (!pagination || pagination.pages <= 1) return null;
  const pageUrl = (page) => {
    const parameters = new URLSearchParams(location.search);
    if (page <= 1) parameters.delete('page'); else parameters.set('page', String(page));
    return `${location.pathname}?${parameters.toString()}`;
  };
  return (
    <nav className="pagination" aria-label={t('pagination.label')}>
      {pagination.page > 1
        ? <Link className="page-control" to={pageUrl(pagination.page - 1)}>← <span>{t('pagination.previous')}</span></Link>
        : <span className="page-control is-disabled">← <span>{t('pagination.previous')}</span></span>}
      <strong>{t('pagination.page', { page: pagination.page, pages: pagination.pages })}</strong>
      {pagination.page < pagination.pages
        ? <Link className="page-control" to={pageUrl(pagination.page + 1)}><span>{t('pagination.next')}</span> →</Link>
        : <span className="page-control is-disabled"><span>{t('pagination.next')}</span> →</span>}
    </nav>
  );
}
