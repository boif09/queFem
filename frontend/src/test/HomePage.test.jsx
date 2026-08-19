import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import i18n from '../i18n.js';
import { HomePage } from '../pages/HomePage.jsx';
import { api } from '../services/api.js';

vi.mock('../services/api.js', () => ({ api: { getPlans: vi.fn(), getCategories: vi.fn() } }));

function Location() { const location = useLocation(); return <output>{location.pathname}{location.search}</output>; }

function renderHome() {
  return render(<MemoryRouter initialEntries={['/']}><Routes><Route path="*" element={<><HomePage /><Location /></>} /></Routes></MemoryRouter>);
}

describe('Pop Editorial home', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    await i18n.changeLanguage('ca');
    api.getPlans.mockResolvedValue({ data: [{
      id: 1, kind: 'event', title: 'Pla real', start_date: '2026-08-19', end_date: '2026-08-19',
      permanent: false, free: true, municipality: 'Barcelona', categories: [{ slug: 'musica', name: 'Música', icon: 'music' }],
    }] });
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

  it('submits quick text search and exposes functional Today and Free actions', async () => {
    const user = userEvent.setup();
    renderHome();
    await user.type(screen.getByRole('searchbox', { name: /Cerca esdeveniments/ }), 'weeknd{Enter}');
    expect(screen.getByText('/plans?q=weeknd')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Avui/ }).getAttribute('href')).toMatch(/^\/plans\?date=\d{4}-\d{2}-\d{2}$/);
    expect(screen.getByRole('link', { name: /Gratis/ })).toHaveAttribute('href', '/plans?free=true');
  });

  it('keeps the brand and natural copy in Spanish without adding account navigation', async () => {
    await i18n.changeLanguage('es');
    renderHome();
    expect(screen.getByText('¿Todavía no? Te encontramos uno.')).toBeInTheDocument();
    expect(screen.queryByText(/Saved|Profile|Cuenta/i)).not.toBeInTheDocument();
  });
});
