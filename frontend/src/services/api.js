const configuredBaseUrl = import.meta.env.VITE_API_URL?.trim() || '';
const API_BASE_URL = configuredBaseUrl.replace(/\/$/, '');

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request(path, parameters = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(parameters)) {
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
  }
  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  const response = await fetch(`${API_BASE_URL}${path}${suffix}`, {
    headers: { Accept: 'application/json' },
  });
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError('Invalid API response', response.status);
  }
  if (!response.ok) {
    throw new ApiError(payload?.error?.message || 'API request failed', response.status);
  }
  return payload;
}

export const api = {
  getPlans(parameters) {
    return request('/api/plans', parameters);
  },
  getPlan(id, language) {
    return request(`/api/plans/${encodeURIComponent(id)}`, { lang: language });
  },
  getComarques() {
    return request('/api/comarques');
  },
  getMunicipalities(comarca) {
    return request('/api/municipalities', { comarca });
  },
  getCategories() {
    return request('/api/categories');
  },
  getSources() {
    return request('/api/sources');
  },
};
