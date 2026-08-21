import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../services/api.js';
import { getQuickDateRange, toISODate } from '../utils/dates.js';
import { CategorySelector } from './CategorySelector.jsx';

const EMPTY_FILTERS = { q: '', date: '', dateFrom: '', dateTo: '', province: '', comarca: '', municipality: '', category: '', free: false };
const ALIASES = new Map([['gerona', 'girona'], ['lerida', 'lleida']]);
function normalizeSearch(value) {
  const text = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  return ALIASES.get(text) || text;
}

function MunicipalityCombobox({ items, value, onChange, loading }) {
  const { t } = useTranslation();
  const listboxId = useId();
  const [query, setQuery] = useState(value || '');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef(null);
  useEffect(() => { setQuery(value || ''); setActiveIndex(-1); }, [value]);
  const matches = useMemo(() => {
    const needle = normalizeSearch(query);
    return items.filter((item) => !needle || normalizeSearch([item.municipality, item.comarca, item.province].filter(Boolean).join(' ')).includes(needle));
  }, [items, query]);
  const choose = (item) => { setQuery(item.municipality); onChange(item.municipality); setOpen(false); setActiveIndex(-1); };
  const clear = () => { setQuery(''); onChange(''); setOpen(true); setActiveIndex(-1); inputRef.current?.focus(); };
  const moveActive = (amount) => {
    if (!matches.length) return;
    setOpen(true);
    setActiveIndex((current) => current < 0 ? (amount > 0 ? 0 : matches.length - 1) : (current + amount + matches.length) % matches.length);
  };
  return <div className={`municipality-combobox${value ? ' has-value' : ''}`}>
    <div className="municipality-control">
      <input ref={inputRef} type="text" value={query} disabled={loading} autoComplete="off" role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={listboxId} aria-activedescendant={activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined} placeholder={t('filters.municipalitySearch')}
        onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
        onChange={(event) => { setQuery(event.target.value); setOpen(true); setActiveIndex(-1); if (value) onChange(''); }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') { event.preventDefault(); moveActive(1); }
          else if (event.key === 'ArrowUp') { event.preventDefault(); moveActive(-1); }
          else if (event.key === 'Escape') { setOpen(false); setActiveIndex(-1); }
          else if (event.key === 'Enter' && (activeIndex >= 0 || matches.length === 1)) { event.preventDefault(); choose(matches[activeIndex >= 0 ? activeIndex : 0]); }
        }} />
      {value && <button type="button" className="municipality-clear" aria-label={t('filters.clearMunicipality')} onMouseDown={(event) => event.preventDefault()} onClick={clear}><span aria-hidden="true">×</span></button>}
      <span className="municipality-chevron" aria-hidden="true" />
    </div>
    {open && <div id={listboxId} className="municipality-options" role="listbox">
      {matches.length === 0 && <p>{t('filters.noMunicipalities')}</p>}
      {matches.map((item, index) => { const context = [item.comarca, item.province].filter(Boolean).join(' · '); return <button id={`${listboxId}-${index}`} type="button" role="option" aria-label={[item.municipality, context].filter(Boolean).join(' · ')} aria-selected={item.municipality === value} className={index === activeIndex ? 'is-active' : ''} key={`${item.municipality}-${context}`} onMouseEnter={() => setActiveIndex(index)} onMouseDown={(event) => { event.preventDefault(); choose(item); }}><strong>{item.municipality}</strong>{context && <small>{context}</small>}</button>; })}
    </div>}
  </div>;
}

export function SearchFilters({ initialFilters = {}, onSearch }) {
  const { t } = useTranslation();
  const [filters, setFilters] = useState({ ...EMPTY_FILTERS, ...initialFilters });
  const [showRange, setShowRange] = useState(Boolean(initialFilters.dateFrom || initialFilters.dateTo));
  const [provinces, setProvinces] = useState([]);
  const [comarques, setComarques] = useState([]);
  const [municipalities, setMunicipalities] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const initialized = useRef(false);
  const lastEmittedKey = useRef('');
  const initialKey = JSON.stringify(initialFilters);

  useEffect(() => {
    const next = { ...EMPTY_FILTERS, ...initialFilters };
    if (JSON.stringify(next) === lastEmittedKey.current) return;
    setFilters((current) => JSON.stringify(current) === JSON.stringify(next) ? current : next);
    setShowRange(Boolean(initialFilters.dateFrom || initialFilters.dateTo));
  }, [initialKey]);

  useEffect(() => {
    let active = true;
    Promise.all([api.getProvinces(), api.getComarques(), api.getMunicipalities(), api.getCategories()])
      .then(([p, c, m, k]) => { if (active) { setProvinces(p.data); setComarques(c.data); setMunicipalities(m.data); setCategories(k.data); } })
      .catch(() => active && setLoadError(true)).finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!initialized.current) { initialized.current = true; return undefined; }
    const timeout = setTimeout(() => {
      const emitted = { ...filters, q: filters.q.trim(), free: filters.free ? 'true' : '' };
      lastEmittedKey.current = JSON.stringify({ ...EMPTY_FILTERS, ...filters, q: filters.q.trim() });
      onSearch(emitted);
    }, 300);
    return () => clearTimeout(timeout);
  }, [filters, onSearch]);

  const reloadLocations = async (province, comarca) => {
    try {
      const [c, m] = await Promise.all([api.getComarques(province), api.getMunicipalities(province, comarca)]);
      setComarques(c.data); setMunicipalities(m.data); setLoadError(false);
    } catch { setLoadError(true); }
  };
  const chooseQuickDate = (type) => { const selected = getQuickDateRange(type); setShowRange(Boolean(selected.dateFrom)); setFilters((current) => ({ ...current, date: selected.date || '', dateFrom: selected.dateFrom || '', dateTo: selected.dateTo || '' })); };
  const chooseCustomRange = () => { setShowRange(true); setFilters((current) => ({ ...current, date: '', dateFrom: current.dateFrom || toISODate(new Date()), dateTo: current.dateTo || toISODate(new Date()) })); };
  const clear = () => { setFilters(EMPTY_FILTERS); setShowRange(false); reloadLocations('', ''); };

  return <form className="search-panel" onSubmit={(event) => event.preventDefault()}>
    <div className="text-search-section"><label htmlFor="plan-text-search">{t('filters.textSearch')}</label><div className="text-search-control"><span aria-hidden="true">⌕</span><input id="plan-text-search" type="search" maxLength="100" value={filters.q} placeholder={t('filters.textSearchPlaceholder')} onChange={(event) => setFilters((current) => ({ ...current, q: event.target.value }))} /></div></div>
    <div className="filter-section filter-section-date">
      <div className="section-heading"><span className="section-number" aria-hidden="true">01</span><div><span>{t('filters.when')}</span><strong>{t('filters.date')}</strong></div></div>
      <div className="quick-date-list" aria-label={t('filters.quickDates')}>{['today', 'tomorrow', 'weekend', 'nextSeven'].map((type) => <button type="button" key={type} onClick={() => chooseQuickDate(type)}>{t(`filters.${type}`)}</button>)}<button type="button" onClick={chooseCustomRange}>{t('filters.chooseDates')}</button></div>
      {showRange ? <div className="date-range"><label><span>{t('filters.from')}</span><input type="date" value={filters.dateFrom} onChange={(event) => setFilters((current) => ({ ...current, dateFrom: event.target.value }))} /></label><label><span>{t('filters.to')}</span><input type="date" min={filters.dateFrom || undefined} value={filters.dateTo} onChange={(event) => setFilters((current) => ({ ...current, dateTo: event.target.value }))} /></label></div> : <label className="single-date"><span>{t('filters.date')}</span><input type="date" value={filters.date} onChange={(event) => setFilters((current) => ({ ...current, date: event.target.value, dateFrom: '', dateTo: '' }))} /></label>}
    </div>
    <div className="filter-section">
      <div className="section-heading"><span className="section-number" aria-hidden="true">02</span><div><span>{t('filters.where')}</span><strong>{t('filters.municipality')}</strong></div></div>
      <div className="location-fields">
        <label><span>{t('filters.province')}</span><select value={filters.province} disabled={loading} onChange={(event) => { const province = event.target.value; const comarca = !filters.comarca || comarques.some((item) => item.comarca === filters.comarca && (!province || item.province === province)) ? filters.comarca : ''; const municipality = !filters.municipality || municipalities.some((item) => item.municipality === filters.municipality && (!province || item.province === province) && (!comarca || item.comarca === comarca)) ? filters.municipality : ''; setFilters((current) => ({ ...current, province, comarca, municipality })); reloadLocations(province, comarca); }}><option value="">{t('filters.allProvinces')}</option>{provinces.map((province) => <option key={province} value={province}>{province}</option>)}</select></label>
        <label><span>{t('filters.comarca')}</span><select value={filters.comarca} disabled={loading} onChange={(event) => { const comarca = event.target.value; const municipality = !filters.municipality || municipalities.some((item) => item.municipality === filters.municipality && (!comarca || item.comarca === comarca)) ? filters.municipality : ''; setFilters((current) => ({ ...current, comarca, municipality })); reloadLocations(filters.province, comarca); }}><option value="">{t('filters.allComarques')}</option>{comarques.map((item) => <option key={`${item.comarca}-${item.province}`} value={item.comarca}>{item.comarca}</option>)}</select></label>
        <label><span>{t('filters.municipality')}</span><MunicipalityCombobox items={municipalities} value={filters.municipality} loading={loading} onChange={(municipality) => setFilters((current) => ({ ...current, municipality }))} /></label>
      </div>
    </div>
    <div className="filter-section"><div className="section-heading"><span className="section-number" aria-hidden="true">03</span><div><span>{t('filters.category')}</span><strong>{t('filters.allCategories')}</strong></div></div><CategorySelector categories={categories} selected={filters.category ? filters.category.split(',') : []} onChange={(values) => setFilters((current) => ({ ...current, category: values.join(',') }))} loading={loading} /></div>
    <div className="filter-actions"><label className="check-control"><input type="checkbox" checked={Boolean(filters.free)} onChange={(event) => setFilters((current) => ({ ...current, free: event.target.checked }))} /><span aria-hidden="true" /><strong>{t('filters.free')}</strong></label><button type="button" className="button button-ghost" onClick={clear}>{t('filters.clear')}</button><span className="field-hint" aria-live="polite">{t('filters.appliesImmediately')}</span></div>
    {loadError && <p className="inline-error" role="alert">{t('filters.loadError')}</p>}
  </form>;
}
