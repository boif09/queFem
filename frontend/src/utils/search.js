export const SEARCH_FILTER_KEYS = [
  'q', 'date', 'dateFrom', 'dateTo', 'province', 'comarca', 'municipality', 'category', 'free', 'kind',
];

export function filtersFromSearchParams(searchParams) {
  return Object.fromEntries(
    SEARCH_FILTER_KEYS
      .map((key) => {
        const value = searchParams.get(key) || '';
        return [key, key === 'q' ? value.trim() : value];
      })
      .filter(([, value]) => value !== ''),
  );
}

export function createPlansSearch(filters, extra = {}) {
  const parameters = new URLSearchParams();
  for (const key of SEARCH_FILTER_KEYS) {
    const rawValue = filters[key];
    const value = key === 'q' && typeof rawValue === 'string' ? rawValue.trim() : rawValue;
    if (value !== undefined && value !== null && value !== '' && value !== false) {
      parameters.set(key, value === true ? 'true' : String(value));
    }
  }
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined && value !== null && value !== '') parameters.set(key, String(value));
  }
  return parameters.toString();
}
