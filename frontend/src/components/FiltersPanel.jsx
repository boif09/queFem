import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SearchFilters } from './SearchFilters.jsx';

export function FiltersPanel({ initialFilters, onSearch, hideDateSection = false, openOnMount = false }) {
  const { t } = useTranslation();
  const filtersPanelRef = useRef(null);
  const [filtersActivated, setFiltersActivated] = useState(() => Boolean(openOnMount));

  useEffect(() => {
    if (openOnMount && filtersPanelRef.current) {
      filtersPanelRef.current.open = true;
      setFiltersActivated(true);
    }
  }, [openOnMount]);

  return <details ref={filtersPanelRef} className="results-filters" id="filters" onToggle={(event) => {
    if (event.currentTarget.open) setFiltersActivated(true);
  }}>
    <summary>{t('results.filtersToggle')}</summary>
    {filtersActivated && <SearchFilters initialFilters={initialFilters} onSearch={onSearch} hideDateSection={hideDateSection} />}
  </details>;
}
