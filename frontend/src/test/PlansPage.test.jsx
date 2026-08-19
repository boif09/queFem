import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import i18n from '../i18n.js';
import { PlansPage } from '../pages/PlansPage.jsx';
import { api } from '../services/api.js';

vi.mock('../services/api.js', () => ({
  api: { getPlans: vi.fn(), getComarques: vi.fn(), getMunicipalities: vi.fn(), getCategories: vi.fn() },
}));

describe('PlansPage', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    await i18n.changeLanguage('ca');
    vi.unstubAllGlobals();
    api.getComarques.mockResolvedValue({ data: ['Barcelones'] });
    api.getMunicipalities.mockResolvedValue({ data: ['Barcelona', 'Badalona'] });
    api.getCategories.mockResolvedValue({
      data: [{ slug: 'musica', name_ca: 'MÃºsica', name_es: 'MÃºsica', icon: 'music' }],
    });
  });

  it('renders the empty result state returned by the API', async () => {
    api.getPlans.mockResolvedValue({
      data: [],
      pagination: { page: 1, limit: 12, total: 0, pages: 0 },
    });
    render(<MemoryRouter initialEntries={['/plans?comarca=Baix%20Empord%C3%A0']}><PlansPage /></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: 'No hem trobat cap pla' })).toBeInTheDocument();
    expect(screen.getByText('0 plans trobats')).toBeInTheDocument();
    expect(api.getPlans).toHaveBeenCalledWith(expect.objectContaining({
      comarca: 'Baix Empordà', lang: 'ca', page: '1', limit: 12,
    }));
  });

  it('sorts dated searches by date so exact events precede permanent plans', async () => {
    api.getPlans.mockResolvedValue({
      data: [], pagination: { page: 1, limit: 12, total: 0, pages: 0 },
    });
    render(<MemoryRouter initialEntries={['/plans?date=2026-09-01&municipality=Barcelona&category=musica']}><PlansPage /></MemoryRouter>);

    await screen.findByRole('heading', { name: 'No hem trobat cap pla' });
    expect(api.getPlans).toHaveBeenCalledWith(expect.objectContaining({
      date: '2026-09-01', municipality: 'Barcelona', category: 'musica', sort: 'date',
    }));
  });

  it('restores q, combines it with filters, sends it to the API and shows its active chip', async () => {
    api.getPlans.mockResolvedValue({
      data: [], pagination: { page: 1, limit: 12, total: 0, pages: 0 },
    });
    render(<MemoryRouter initialEntries={['/plans?q=Weeknd&date=2026-09-01&municipality=Barcelona&category=musica']}><PlansPage /></MemoryRouter>);

    await screen.findByRole('heading', { name: 'No hem trobat cap pla' });
    expect(api.getPlans).toHaveBeenCalledWith(expect.objectContaining({
      q: 'Weeknd', date: '2026-09-01', municipality: 'Barcelona', category: 'musica',
    }));
    expect(screen.getByText('Cerca: Weeknd')).toBeInTheDocument();
  });

  function LocationProbe() {
    const location = useLocation();
    return <output data-testid="current-location">{`${location.pathname}${location.search}`}</output>;
  }

  function renderPlans(entry = '/plans') {
    api.getPlans.mockResolvedValue({
      data: [], pagination: { page: 1, limit: 12, total: 0, pages: 0 },
    });
    return render(
      <MemoryRouter initialEntries={[entry]}>
        <PlansPage />
        <LocationProbe />
      </MemoryRouter>,
    );
  }

  async function apply(user) {
    await user.click(await screen.findByRole('button', { name: /Buscar plans/i }));
  }

  it('applies municipality and replaces it when the selection changes', async () => {
    const user = userEvent.setup();
    renderPlans();
    const [comarca, municipality] = await screen.findAllByRole('combobox');
    await user.selectOptions(comarca, 'Barcelones');
    await user.selectOptions(municipality, 'Barcelona');
    await apply(user);
    await waitFor(() => expect(screen.getByTestId('current-location')).toHaveTextContent(
      '/plans?comarca=Barcelones&municipality=Barcelona',
    ));

    await user.selectOptions((await screen.findAllByRole('combobox'))[1], 'Badalona');
    await apply(user);
    await waitFor(() => {
      const url = screen.getByTestId('current-location').textContent;
      expect(url).toContain('municipality=Badalona');
      expect(url).not.toContain('municipality=Barcelona');
    });
  });

  it('applies category, date and free through the real submit button', async () => {
    const user = userEvent.setup();
    renderPlans();
    await user.click(await screen.findByRole('button', { name: /sica$/i }));
    await user.type(screen.getByLabelText('Data'), '2026-09-01');
    await user.click(screen.getByRole('checkbox'));
    await apply(user);
    await waitFor(() => expect(screen.getByTestId('current-location')).toHaveTextContent(
      '/plans?date=2026-09-01&category=musica&free=true',
    ));
  });

  it('combines trimmed q with filters and omits empty values', async () => {
    const user = userEvent.setup();
    renderPlans();
    await user.type(screen.getByRole('searchbox', { name: 'Cerca' }), '  weeknd  ');
    const [comarca, municipality] = await screen.findAllByRole('combobox');
    await user.selectOptions(comarca, 'Barcelones');
    await user.selectOptions(municipality, 'Barcelona');
    await apply(user);
    await waitFor(() => {
      const url = screen.getByTestId('current-location').textContent;
      expect(url).toContain('q=weeknd');
      expect(url).toContain('municipality=Barcelona');
      expect(url).not.toMatch(/date=&|category=&|free=/);
    });
  });

  it('restores form values from the URL and clears them on submit', async () => {
    const user = userEvent.setup();
    renderPlans('/plans?q=weeknd&date=2026-09-01&category=musica&free=true');
    expect(await screen.findByRole('searchbox', { name: 'Cerca' })).toHaveValue('weeknd');
    expect(screen.getByLabelText('Data')).toHaveValue('2026-09-01');
    expect(await screen.findByRole('button', { name: /sica$/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('checkbox')).toBeChecked();

    await user.click(screen.getByRole('button', { name: 'Esborrar filtres' }));
    await apply(user);
    await waitFor(() => expect(screen.getByTestId('current-location')).toHaveTextContent(/^\/plans$/));
  });

  it('submits with Enter and closes an open filter panel on mobile', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    const user = userEvent.setup();
    const { container } = renderPlans({ pathname: '/plans', state: { openFilters: true } });
    const panel = container.querySelector('.results-filters');
    await user.click(screen.getByText('Filtres de cerca'));
    expect(panel).toHaveAttribute('open');
    await user.type(await screen.findByRole('searchbox', { name: 'Cerca' }), 'weeknd{Enter}');
    await waitFor(() => expect(screen.getByTestId('current-location')).toHaveTextContent('/plans?q=weeknd'));
    expect(panel).not.toHaveAttribute('open');
  });
});
