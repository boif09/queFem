import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '../App.jsx';
import i18n from '../i18n.js';
import { DiscoveryLandingPage } from '../pages/DiscoveryLandingPage.jsx';
import { api } from '../services/api.js';

vi.mock('../services/api.js', () => ({ api: { getPlans: vi.fn() } }));

const plan = {
  id: 42,
  kind: 'event',
  title: 'Concert de prova',
  start_date: '2026-09-11',
  end_date: '2026-09-11',
  permanent: false,
  free: true,
  municipality: 'Barcelona',
  categories: [],
};

function renderLanding(type, entry, now) {
  return render(<MemoryRouter initialEntries={[entry]}>
    <DiscoveryLandingPage type={type} now={now} />
  </MemoryRouter>);
}

describe('discovery landing pages', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    await i18n.changeLanguage('ca');
    api.getPlans.mockResolvedValue({ data: [plan] });
  });

  it.each([
    ['/avui', 'Què fer avui a Catalunya'],
    ['/cap-de-setmana', 'Què fer aquest cap de setmana a Catalunya'],
  ])('registers the %s application route', async (path, heading) => {
    render(<MemoryRouter initialEntries={[path]}><AppRoutes /></MemoryRouter>);
    expect(screen.getByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Concert de prova' })).toBeInTheDocument();
  });

  it('renders /avui with its heading, today results and canonical detail links', async () => {
    renderLanding('today', '/avui', new Date('2026-06-30T22:30:00.000Z'));
    expect(screen.getByRole('heading', { level: 1, name: 'Què fer avui a Catalunya' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Concert de prova' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Concert de prova/ })).toHaveAttribute('href', '/plans/42');
    expect(api.getPlans).toHaveBeenCalledWith(expect.objectContaining({
      date: '2026-07-01', sort: 'date', page: 1, limit: 24, lang: 'ca',
    }));
    await waitFor(() => expect(document.head.querySelector('link[rel="canonical"]')).toHaveAttribute('href', 'https://tenspla.cat/avui'));
  });

  it('renders /cap-de-setmana with existing weekend filtering and ranking parameters', async () => {
    renderLanding('weekend', '/cap-de-setmana', new Date('2026-09-10T10:00:00.000Z'));
    expect(screen.getByRole('heading', { level: 1, name: 'Què fer aquest cap de setmana a Catalunya' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Concert de prova' })).toBeInTheDocument();
    expect(api.getPlans).toHaveBeenCalledWith(expect.objectContaining({
      dateFrom: '2026-09-11', dateTo: '2026-09-13', permanent: false,
      editorial: 'home-weekend', sort: 'date', page: 1, limit: 24, lang: 'ca',
    }));
  });

  it('uses the normal empty state when a landing has no plans', async () => {
    api.getPlans.mockResolvedValue({ data: [] });
    renderLanding('today', '/avui', new Date('2026-09-10T10:00:00.000Z'));
    expect(await screen.findByRole('heading', { name: 'No hem trobat cap pla' })).toBeInTheDocument();
  });

  it('keeps a contextual location query useful but non-indexable', async () => {
    renderLanding('today', '/avui?province=Girona', new Date('2026-09-10T10:00:00.000Z'));
    await waitFor(() => expect(api.getPlans).toHaveBeenCalledWith(expect.objectContaining({
      province: 'Girona', date: '2026-09-10',
    })));
    expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute('content', 'noindex,follow');
    expect(document.head.querySelector('link[rel="canonical"]')).not.toBeInTheDocument();
  });
});
