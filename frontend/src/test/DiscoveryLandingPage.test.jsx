import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { AppRoutes } from '../App.jsx';
import i18n from '../i18n.js';
import { DiscoveryLandingPage } from '../pages/DiscoveryLandingPage.jsx';
import { api } from '../services/api.js';

vi.mock('../services/api.js', () => ({
  api: {
    getPlans: vi.fn(), getProvinces: vi.fn(), getComarques: vi.fn(), getMunicipalities: vi.fn(), getCategories: vi.fn(),
  },
}));

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

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="current-location">{`${location.pathname}${location.search}`}</output>;
}

function renderInteractiveLanding(type, entry, now) {
  return render(<MemoryRouter initialEntries={[entry]}>
    <DiscoveryLandingPage type={type} now={now} />
    <LocationProbe />
  </MemoryRouter>);
}

describe('discovery landing pages', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    await i18n.changeLanguage('ca');
    api.getPlans.mockResolvedValue({ data: [plan] });
    api.getProvinces.mockResolvedValue({ data: ['Barcelona'] });
    api.getComarques.mockResolvedValue({ data: [{ comarca: 'Barcelones', province: 'Barcelona' }] });
    api.getMunicipalities.mockResolvedValue({ data: [{ municipality: 'Barcelona', comarca: 'Barcelones', province: 'Barcelona' }] });
    api.getCategories.mockResolvedValue({ data: [{ slug: 'musica', name_ca: 'MÃºsica', name_es: 'MÃºsica', icon: 'music' }] });
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

  it.each([
    ['today', '/avui', new Date('2026-09-10T10:00:00.000Z')],
    ['weekend', '/cap-de-setmana', new Date('2026-09-10T10:00:00.000Z')],
  ])('renders the shared non-date filters for %s', async (type, entry, now) => {
    const user = userEvent.setup();
    renderInteractiveLanding(type, entry, now);
    await user.click(screen.getByText('Filtres de cerca'));
    expect(await screen.findByRole('combobox', { name: /rov/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sica$/i })).toBeInTheDocument();
    expect(document.querySelector('.filter-section-date')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Data')).not.toBeInTheDocument();
  });

  it('applies and clears non-date filters without losing today scope', async () => {
    const user = userEvent.setup();
    renderInteractiveLanding('today', '/avui', new Date('2026-09-10T10:00:00.000Z'));
    await user.click(screen.getByText('Filtres de cerca'));
    await user.click(await screen.findByRole('button', { name: /sica$/i }));
    await waitFor(() => expect(screen.getByTestId('current-location')).toHaveTextContent('/avui?category=musica'));
    await waitFor(() => expect(api.getPlans).toHaveBeenLastCalledWith(expect.objectContaining({ category: 'musica', date: '2026-09-10' })));
    expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute('content', 'noindex,follow');
    expect(document.head.querySelector('link[rel="canonical"]')).not.toBeInTheDocument();
    await user.click(document.querySelector('.clear-active-filters'));
    await waitFor(() => expect(screen.getByTestId('current-location')).toHaveTextContent('/avui'));
    await waitFor(() => expect(api.getPlans).toHaveBeenLastCalledWith(expect.objectContaining({ date: '2026-09-10' })));
  });

  it('keeps weekend range while applying a territory filter and switches filter labels to Spanish', async () => {
    const user = userEvent.setup();
    renderInteractiveLanding('weekend', '/cap-de-setmana', new Date('2026-09-10T10:00:00.000Z'));
    await user.click(screen.getByText('Filtres de cerca'));
    await user.selectOptions(await screen.findByRole('combobox', { name: /rov/i }), 'Barcelona');
    await waitFor(() => expect(api.getPlans).toHaveBeenLastCalledWith(expect.objectContaining({
      province: 'Barcelona', dateFrom: '2026-09-11', dateTo: '2026-09-13',
    })));
    await user.click(document.querySelector('.clear-active-filters'));
    await waitFor(() => expect(api.getPlans).toHaveBeenLastCalledWith(expect.objectContaining({
      dateFrom: '2026-09-11', dateTo: '2026-09-13',
    })));
    await i18n.changeLanguage('es');
    expect(await screen.findByRole('combobox', { name: /rovincia/i })).toBeInTheDocument();
  });
});
