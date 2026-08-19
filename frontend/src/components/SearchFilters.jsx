import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../services/api.js';
import { getQuickDateRange, toISODate } from '../utils/dates.js';
import { CategorySelector } from './CategorySelector.jsx';

const EMPTY_FILTERS = {
  q: '', date: '', dateFrom: '', dateTo: '', comarca: '', municipality: '', category: '', free: false,
};

export function SearchFilters({ initialFilters = {}, onSearch }) {
  const { t } = useTranslation();
  const [filters, setFilters] = useState({ ...EMPTY_FILTERS, ...initialFilters });
  const [showRange, setShowRange] = useState(Boolean(initialFilters.dateFrom || initialFilters.dateTo));
  const [comarques, setComarques] = useState([]);
  const [municipalities, setMunicipalities] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loadingBase, setLoadingBase] = useState(true);
  const [loadingMunicipalities, setLoadingMunicipalities] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([api.getComarques(), api.getCategories()])
      .then(([locationPayload, categoryPayload]) => {
        if (!active) return;
        setComarques(locationPayload.data);
        setCategories(categoryPayload.data);
        setLoadError(false);
      })
      .catch(() => active && setLoadError(true))
      .finally(() => active && setLoadingBase(false));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    if (!filters.comarca) {
      setMunicipalities([]);
      return () => { active = false; };
    }
    setLoadingMunicipalities(true);
    api.getMunicipalities(filters.comarca)
      .then((payload) => active && setMunicipalities(payload.data))
      .catch(() => active && setLoadError(true))
      .finally(() => active && setLoadingMunicipalities(false));
    return () => { active = false; };
  }, [filters.comarca]);

  const update = (key, value) => setFilters((current) => ({ ...current, [key]: value }));
  const chooseQuickDate = (type) => {
    const selected = getQuickDateRange(type);
    setShowRange(Boolean(selected.dateFrom));
    setFilters((current) => ({
      ...current,
      date: selected.date || '',
      dateFrom: selected.dateFrom || '',
      dateTo: selected.dateTo || '',
    }));
  };
  const chooseCustomRange = () => {
    setShowRange(true);
    setFilters((current) => ({
      ...current,
      date: '',
      dateFrom: current.dateFrom || toISODate(new Date()),
      dateTo: current.dateTo || toISODate(new Date()),
    }));
  };
  const clear = () => {
    setFilters(EMPTY_FILTERS);
    setShowRange(false);
    setMunicipalities([]);
  };
  const submit = (event) => {
    event.preventDefault();
    onSearch({
      ...filters,
      q: filters.q.trim(),
      free: filters.free ? 'true' : '',
    });
  };

  return (
    <form className="search-panel" onSubmit={submit}>
      <div className="text-search-section">
        <label htmlFor="plan-text-search">{t('filters.textSearch')}</label>
        <div className="text-search-control">
          <span aria-hidden="true">⌕</span>
          <input
            id="plan-text-search"
            type="search"
            maxLength="100"
            value={filters.q}
            placeholder={t('filters.textSearchPlaceholder')}
            onChange={(event) => update('q', event.target.value)}
          />
        </div>
      </div>
      <div className="filter-section filter-section-date">
        <div className="section-heading">
          <span className="section-number" aria-hidden="true">01</span>
          <div><span>{t('filters.when')}</span><strong>{t('filters.date')}</strong></div>
        </div>
        <div className="quick-date-list" aria-label={t('filters.quickDates')}>
          <button type="button" onClick={() => chooseQuickDate('today')}>{t('filters.today')}</button>
          <button type="button" onClick={() => chooseQuickDate('tomorrow')}>{t('filters.tomorrow')}</button>
          <button type="button" onClick={() => chooseQuickDate('weekend')}>{t('filters.weekend')}</button>
          <button type="button" onClick={() => chooseQuickDate('nextSeven')}>{t('filters.nextSeven')}</button>
          <button type="button" onClick={chooseCustomRange}>{t('filters.chooseDates')}</button>
        </div>
        {showRange ? (
          <div className="date-range">
            <label><span>{t('filters.from')}</span><input type="date" value={filters.dateFrom} onChange={(event) => update('dateFrom', event.target.value)} /></label>
            <label><span>{t('filters.to')}</span><input type="date" min={filters.dateFrom || undefined} value={filters.dateTo} onChange={(event) => update('dateTo', event.target.value)} /></label>
          </div>
        ) : (
          <label className="single-date"><span>{t('filters.date')}</span><input type="date" value={filters.date} onChange={(event) => setFilters((current) => ({ ...current, date: event.target.value, dateFrom: '', dateTo: '' }))} /></label>
        )}
      </div>

      <div className="filter-section">
        <div className="section-heading">
          <span className="section-number" aria-hidden="true">02</span>
          <div><span>{t('filters.where')}</span><strong>{t('filters.comarca')}</strong></div>
        </div>
        <div className="location-fields">
          <label>
            <span>{t('filters.comarca')}</span>
            <select
              value={filters.comarca}
              disabled={loadingBase}
              onChange={(event) => setFilters((current) => ({ ...current, comarca: event.target.value, municipality: '' }))}
            >
              <option value="">{t('filters.allComarques')}</option>
              {comarques.map((comarca) => <option key={comarca} value={comarca}>{comarca}</option>)}
            </select>
          </label>
          <label>
            <span>{t('filters.municipality')}</span>
            <select
              value={filters.municipality}
              disabled={!filters.comarca || loadingMunicipalities}
              onChange={(event) => update('municipality', event.target.value)}
            >
              <option value="">{filters.comarca ? t('filters.allMunicipalities') : t('filters.chooseComarcaFirst')}</option>
              {municipalities.map((municipality) => <option key={municipality} value={municipality}>{municipality}</option>)}
            </select>
          </label>
        </div>
        {loadingMunicipalities && <p className="field-hint">{t('filters.loadingLocations')}</p>}
      </div>

      <div className="filter-section">
        <div className="section-heading">
          <span className="section-number" aria-hidden="true">03</span>
          <div><span>{t('filters.category')}</span><strong>{t('filters.allCategories')}</strong></div>
        </div>
        <CategorySelector categories={categories} selected={filters.category} onChange={(value) => update('category', value)} loading={loadingBase} />
      </div>

      <div className="filter-actions">
        <label className="check-control">
          <input type="checkbox" checked={Boolean(filters.free)} onChange={(event) => update('free', event.target.checked)} />
          <span aria-hidden="true" />
          <strong>{t('filters.free')}</strong>
        </label>
        <div className="action-buttons">
          <button type="button" className="button button-ghost" onClick={clear}>{t('filters.clear')}</button>
          <button type="submit" className="button button-primary" disabled={loadingBase}>{t('filters.search')}<span aria-hidden="true">→</span></button>
        </div>
      </div>
      {loadError && <p className="inline-error" role="alert">{t('filters.loadError')}</p>}
    </form>
  );
}
