import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { SearchFilters } from '../components/SearchFilters.jsx';
import { createPlansSearch, filtersFromSearchParams } from '../utils/search.js';

export function HomePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialFilters = filtersFromSearchParams(searchParams);
  const search = (filters) => {
    const query = createPlansSearch(filters);
    navigate(query ? `/plans?${query}` : '/plans');
  };
  return (
    <>
      <section className="hero">
        <div className="hero-pattern" aria-hidden="true"><i /><i /><i /><i /></div>
        <div className="container hero-content">
          <p className="eyebrow">{t('home.eyebrow')}</p>
          <h1>{t('home.title')}</h1>
          <p className="hero-intro">{t('home.intro')}</p>
          <div className="trust-note"><span aria-hidden="true">✓</span>{t('home.trust')}</div>
        </div>
      </section>
      <section className="search-section">
        <div className="container">
          <p className="section-kicker">{t('home.discover')}</p>
          <SearchFilters initialFilters={initialFilters} onSearch={search} />
        </div>
      </section>
    </>
  );
}
