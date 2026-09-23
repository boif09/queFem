import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import i18n from '../i18n.js';
import { DiscoveryLandingPage } from '../pages/DiscoveryLandingPage.jsx';
import { PlansPage } from '../pages/PlansPage.jsx';
import { PlanDetailPage } from '../pages/PlanDetailPage.jsx';
import { api } from '../services/api.js';
import { captureSocialAttributionFromLocation } from '../services/socialAttribution.js';

vi.mock('../services/api.js', () => ({
  api: { getPlans: vi.fn(), getPlan: vi.fn() },
}));

function events(track, name) {
  return track.mock.calls.filter(([eventName]) => eventName === name);
}

function NavigationButton({ to }) {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate(to)}>navigate</button>;
}

describe('analytics page views', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    window.umami = { track: vi.fn() };
    await i18n.changeLanguage('ca');
    api.getPlans.mockResolvedValue({ data: [], pagination: { page: 1, limit: 12, total: 0, pages: 0 } });
  });

  it.each([
    ['weekend', '/cap-de-setmana', 'cap-de-setmana'],
    ['today', '/avui', 'avui'],
  ])('tracks %s collection once under StrictMode, independent of its query', async (type, entry, collection) => {
    captureSocialAttributionFromLocation('?utm_source=instagram&utm_medium=social&utm_campaign=2026w39-capsetmana');
    render(<StrictMode><MemoryRouter initialEntries={[entry]}><DiscoveryLandingPage type={type} now={new Date('2026-09-10')} /><NavigationButton to={`${entry}?page=2`} /></MemoryRouter></StrictMode>);
    await screen.findByText(/No hem trobat cap pla/);
    fireEvent.click(screen.getByRole('button', { name: 'navigate' }));
    expect(events(window.umami.track, 'collection_view')).toEqual([['collection_view', {
      collection, language: 'ca', social_source: 'instagram', social_medium: 'social', social_campaign: '2026w39-capsetmana',
    }]]);
  });

  it('tracks plans once under StrictMode despite query changes', async () => {
    render(<StrictMode><MemoryRouter initialEntries={['/plans']}><PlansPage /><NavigationButton to="/plans?page=2" /></MemoryRouter></StrictMode>);
    await screen.findByText('0 plans trobats');
    fireEvent.click(screen.getByRole('button', { name: 'navigate' }));
    expect(events(window.umami.track, 'collection_view')).toEqual([['collection_view', { collection: 'plans', language: 'ca' }]]);
  });

  it('tracks every navigation when the shared landing instance returns to a collection', () => {
    const { rerender } = render(<StrictMode><MemoryRouter initialEntries={['/avui']}><DiscoveryLandingPage type="today" now={new Date('2026-09-10')} /></MemoryRouter></StrictMode>);
    rerender(<StrictMode><MemoryRouter initialEntries={['/cap-de-setmana']}><DiscoveryLandingPage type="weekend" now={new Date('2026-09-10')} /></MemoryRouter></StrictMode>);
    rerender(<StrictMode><MemoryRouter initialEntries={['/avui']}><DiscoveryLandingPage type="today" now={new Date('2026-09-10')} /></MemoryRouter></StrictMode>);
    expect(events(window.umami.track, 'collection_view')).toEqual([
      ['collection_view', { collection: 'avui', language: 'ca' }],
      ['collection_view', { collection: 'cap-de-setmana', language: 'ca' }],
      ['collection_view', { collection: 'avui', language: 'ca' }],
    ]);
  });

  it('tracks a successfully loaded plan once under StrictMode with attribution', async () => {
    captureSocialAttributionFromLocation('?utm_source=tiktok&utm_medium=social&utm_content=20260925-capsetmana5.story');
    api.getPlan.mockResolvedValue({ data: { id: 31, kind: 'event', title: 'Pla', start_date: '2026-09-01', end_date: '2026-09-01', categories: [], sources: [], commerce: { provider: 'fever' } } });
    render(<StrictMode><MemoryRouter initialEntries={['/plans/31']}><Routes><Route path="/plans/:id" element={<PlanDetailPage />} /></Routes></MemoryRouter></StrictMode>);
    await screen.findByRole('heading', { name: 'Pla' });
    expect(events(window.umami.track, 'plan_view')).toEqual([['plan_view', {
      plan_id: 31, has_affiliate: true, language: 'ca', social_source: 'tiktok', social_medium: 'social', social_content: '20260925-capsetmana5.story',
    }]]);
  });

  it('does not track plans that fail or are not found', async () => {
    api.getPlan.mockRejectedValue({ status: 404 });
    render(<StrictMode><MemoryRouter initialEntries={['/plans/404']}><Routes><Route path="/plans/:id" element={<PlanDetailPage />} /></Routes></MemoryRouter></StrictMode>);
    await screen.findByRole('alert');
    expect(events(window.umami.track, 'plan_view')).toEqual([]);
  });

  it('tracks each plan navigation, including a return to an already viewed plan', async () => {
    api.getPlan.mockImplementation((id) => Promise.resolve({ data: {
      id: Number(id), kind: 'event', title: `Pla ${id}`, start_date: '2026-09-01', end_date: '2026-09-01', categories: [], sources: [],
    } }));
    const { rerender } = render(<StrictMode><MemoryRouter initialEntries={['/plans/31']}><Routes><Route path="/plans/:id" element={<PlanDetailPage />} /></Routes><NavigationButton to="/plans/32" /></MemoryRouter></StrictMode>);
    await screen.findByRole('heading', { name: 'Pla 31' });
    fireEvent.click(screen.getByRole('button', { name: 'navigate' }));
    await screen.findByRole('heading', { name: 'Pla 32' });
    rerender(<StrictMode><MemoryRouter initialEntries={['/plans/31']}><Routes><Route path="/plans/:id" element={<PlanDetailPage />} /></Routes><NavigationButton to="/plans/31" /></MemoryRouter></StrictMode>);
    fireEvent.click(screen.getByRole('button', { name: 'navigate' }));
    await waitFor(() => expect(events(window.umami.track, 'plan_view')).toEqual([
      ['plan_view', { plan_id: 31, has_affiliate: false, language: 'ca' }],
      ['plan_view', { plan_id: 32, has_affiliate: false, language: 'ca' }],
      ['plan_view', { plan_id: 31, has_affiliate: false, language: 'ca' }],
    ]));
  });

  it('does not track a language refetch of the same loaded plan again', async () => {
    api.getPlan.mockResolvedValue({ data: { id: 31, kind: 'event', title: 'Pla', start_date: '2026-09-01', end_date: '2026-09-01', categories: [], sources: [] } });
    render(<StrictMode><MemoryRouter initialEntries={['/plans/31']}><Routes><Route path="/plans/:id" element={<PlanDetailPage />} /></Routes></MemoryRouter></StrictMode>);
    await screen.findByRole('heading', { name: 'Pla' });
    await i18n.changeLanguage('es');
    await waitFor(() => expect(api.getPlan).toHaveBeenCalledWith('31', 'es'));
    expect(events(window.umami.track, 'plan_view')).toEqual([['plan_view', {
      plan_id: 31, has_affiliate: false, language: 'ca',
    }]]);
  });
});
