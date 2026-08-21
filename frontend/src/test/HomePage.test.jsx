import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import i18n from '../i18n.js';
import { HomePage } from '../pages/HomePage.jsx';
import { api } from '../services/api.js';
import { LOCATION_PREFERENCE_KEY } from '../utils/locationPreference.js';

vi.mock('../services/api.js', () => ({ api: { getPlans: vi.fn(), getCategories: vi.fn() } }));

function Location() { const location = useLocation(); return <output>{location.pathname}{location.search}</output>; }

function renderHome() {
  return render(<MemoryRouter initialEntries={['/']}><Routes><Route path="*" element={<><HomePage /><Location /></>} /></Routes></MemoryRouter>);
}

describe('Pop Editorial home', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    localStorage.clear();
    await i18n.changeLanguage('ca');
    const plan = (id, title, permanent = false) => ({ id, kind: 'event', title, start_date: permanent ? null : `2026-08-${20 + id}`, end_date: permanent ? null : `2026-08-${20 + id}`, permanent, free: true, municipality: 'Barcelona', categories: [{ slug: 'musica', name: 'Música', icon: 'music' }] });
    api.getPlans.mockImplementation((parameters) => {
      if (parameters.permanent === true) return Promise.resolve({ data: [plan(3, 'Pla permanent', true)] });
      if (parameters.dateTo) return Promise.resolve({ data: [plan(1, 'Pla real')] });
      return Promise.resolve({ data: [plan(1, 'Pla real'), plan(2, 'Pla proper')] });
    });
    api.getCategories.mockResolvedValue({ data: [{ slug: 'musica', name_ca: 'Música', name_es: 'Música', icon: 'music' }] });
  });

  it('shows Tens pla?, real API plans and real category navigation without legacy branding', async () => {
    renderHome();
    expect(screen.getAllByLabelText('Tens pla?').length).toBeGreaterThan(0);
    expect(await screen.findByRole('heading', { name: 'Pla real' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Música/ })).toHaveAttribute('href', '/plans?category=musica');
    expect(screen.queryByText('Què Fem?')).not.toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe('Tens pla? | Plans i activitats a Catalunya'));
    expect(document.head.querySelector('meta[name="description"]')).toHaveAttribute('content', expect.stringContaining('Descobreix concerts'));
    expect(document.head.querySelector('link[rel="canonical"]')).toHaveAttribute('href', 'https://tenspla.cat/');
    expect(document.head.querySelector('meta[property="og:title"]')).toHaveAttribute('content', document.title);
    expect(document.head.querySelector('meta[property="og:url"]')).toHaveAttribute('content', 'https://tenspla.cat/');
  });

  it('submits contextual text searches and exposes the three Discovery V2 date actions', async () => {
    const user = userEvent.setup();
    renderHome();
    await user.type(screen.getByRole('searchbox', { name: /Cerca esdeveniments/ }), 'weeknd{Enter}');
    expect(screen.getByText('/plans?q=weeknd')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Avui/ }).getAttribute('href')).toMatch(/^\/plans\?date=\d{4}-\d{2}-\d{2}$/);
    expect(screen.getByRole('link', { name: /Demà/ }).getAttribute('href')).toMatch(/^\/plans\?date=\d{4}-\d{2}-\d{2}$/);
    expect(screen.getAllByRole('link', { name: /Aquest cap de setmana/ })[0].getAttribute('href')).toMatch(/^\/plans\?dateFrom=\d{4}-\d{2}-\d{2}&dateTo=\d{4}-\d{2}-\d{2}$/);
  });

  it('separates weekend, deduplicated upcoming and permanent plans', async () => {
    renderHome();
    expect(await screen.findByRole('heading', { name: 'Pla real' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Pla proper' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Pla permanent' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { name: 'Pla real' })).toHaveLength(1);
    await waitFor(() => expect(api.getPlans).toHaveBeenCalledWith(expect.objectContaining({
      editorial: 'home-weekend', permanent: false, limit: 6, dateFrom: expect.any(String), dateTo: expect.any(String),
    })));
    expect(api.getPlans).toHaveBeenCalledWith(expect.objectContaining({
      editorial: 'home-upcoming', permanent: false, limit: 18, dateFrom: expect.any(String),
    }));
    expect(api.getPlans).toHaveBeenCalledWith(expect.objectContaining({ permanent: true, limit: 3 }));
  });

  it('uses an explicitly remembered location in queries, links and its understandable label', async () => {
    localStorage.setItem(LOCATION_PREFERENCE_KEY, JSON.stringify({ version: 1, location: { comarca: 'Baix Empordà', municipality: 'Begur' } }));
    renderHome();
    expect(screen.getByText(/Begur · Baix Empordà/)).toBeInTheDocument();
    await waitFor(() => expect(api.getPlans).toHaveBeenCalledWith(expect.objectContaining({ comarca: 'Baix Empordà', municipality: 'Begur', permanent: false })));
    const categoryUrl = new URL((await screen.findByRole('link', { name: /Música/ })).getAttribute('href'), 'https://tenspla.cat');
    expect(Object.fromEntries(categoryUrl.searchParams)).toEqual(expect.objectContaining({ category: 'musica', comarca: 'Baix Empordà', municipality: 'Begur' }));
    expect(screen.getByRole('link', { name: /Avui/ }).getAttribute('href')).toContain('comarca=Baix+Empord%C3%A0&municipality=Begur');
  });

  it('offers explicit location recovery for empty blocks and reloads Catalunya after removal', async () => {
    const user = userEvent.setup();
    localStorage.setItem(LOCATION_PREFERENCE_KEY, JSON.stringify({ version: 1, location: { province: 'Girona' } }));
    api.getPlans.mockResolvedValue({ data: [] });
    renderHome();
    expect((await screen.findAllByRole('heading', { name: 'No hi ha plans amb aquesta ubicació' })).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: 'Canviar ubicació' })[0]).toHaveAttribute('href', '/plans?province=Girona#filters');
    await user.click(screen.getAllByRole('button', { name: 'Veure tot Catalunya' })[0]);
    expect(localStorage.getItem(LOCATION_PREFERENCE_KEY)).toBeNull();
    expect(screen.getByText(/tot Catalunya/)).toBeInTheDocument();
    await waitFor(() => expect(api.getPlans).toHaveBeenCalledWith(expect.not.objectContaining({ province: 'Girona' })));
  });

  it('keeps the brand and natural copy in Spanish without adding account navigation', async () => {
    await i18n.changeLanguage('es');
    renderHome();
    expect(screen.getByText('¿Todavía no? Te encontramos uno.')).toBeInTheDocument();
    expect(screen.queryByText(/Saved|Profile|Cuenta/i)).not.toBeInTheDocument();
  });

  it('uses local decorative category photos and preserves the pattern fallback and links in CA/ES', async () => {
    api.getCategories.mockResolvedValue({ data: [
      { slug: 'cultura', name_ca: 'Cultura', name_es: 'Cultura', icon: 'culture' },
      { slug: 'natura', name_ca: 'Natura', name_es: 'Naturaleza', icon: 'nature' },
    ] });
    const { container } = renderHome();
    const culturaLink = await screen.findByRole('link', { name: 'Cultura' });
    const photo = culturaLink.querySelector('img');
    expect(photo).toHaveAttribute('src', '/images/explore/cultura.webp');
    expect(photo).toHaveAttribute('alt', '');
    expect(photo).toHaveAttribute('decoding', 'async');
    expect(culturaLink.querySelector('.category-icon')).not.toBeInTheDocument();
    expect(culturaLink.querySelector('.explore-category-artwork i')).not.toBeInTheDocument();
    expect(culturaLink).toHaveAttribute('href', '/plans?category=cultura');

    const naturaLink = screen.getByRole('link', { name: 'Natura' });
    expect(naturaLink.querySelector('img')).not.toBeInTheDocument();
    expect(naturaLink.querySelector('.category-icon')).toBeInTheDocument();
    expect(naturaLink.querySelectorAll('.explore-category-artwork i')).toHaveLength(2);
    expect(container.querySelectorAll('.explore-category-photo')).toHaveLength(1);

    await i18n.changeLanguage('es');
    await waitFor(() => expect(screen.getByRole('link', { name: 'Naturaleza' })).toHaveAttribute('href', '/plans?category=natura'));
    expect(screen.getByRole('link', { name: 'Cultura' }).querySelector('img')).toHaveAttribute('src', '/images/explore/cultura.webp');
  });
});
