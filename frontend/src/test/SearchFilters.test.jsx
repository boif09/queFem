import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../i18n.js';
import { SearchFilters } from '../components/SearchFilters.jsx';
import { api } from '../services/api.js';
import { LOCATION_PREFERENCE_KEY } from '../utils/locationPreference.js';

vi.mock('../services/api.js', () => ({
  api: {
    getComarques: vi.fn(),
    getProvinces: vi.fn(),
    getMunicipalities: vi.fn(),
    getCategories: vi.fn(),
  },
}));

describe('SearchFilters', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    localStorage.clear();
    await i18n.changeLanguage('ca');
    api.getProvinces.mockResolvedValue({ data: ['Barcelona', 'Girona'] });
    api.getComarques.mockResolvedValue({ data: [{ comarca: 'Baix Empordà', province: 'Girona' }, { comarca: 'Barcelonès', province: 'Barcelona' }] });
    api.getCategories.mockResolvedValue({
      data: [{ slug: 'musica', name_ca: 'Música', name_es: 'Música', icon: 'music' }],
    });
    api.getMunicipalities.mockResolvedValue({ data: [{ municipality: 'Begur', comarca: 'Baix Empordà', province: 'Girona' }, { municipality: 'Palafrugell', comarca: 'Baix Empordà', province: 'Girona' }] });
  });

  it('loads locations from the API, filters municipalities and generates a search', async () => {
    const user = userEvent.setup();
    const onSearch = vi.fn();
    render(<SearchFilters onSearch={onSearch} />);

    expect(screen.getByRole('searchbox', { name: 'Cerca' })).toHaveAttribute(
      'placeholder', 'Busca un concert, una festa, una exposició...',
    );
    await user.type(screen.getByRole('searchbox', { name: 'Cerca' }), '  rock  ');

    await screen.findByRole('option', { name: 'Baix Empordà' });
    await user.selectOptions(screen.getByLabelText('Comarca'), 'Baix Empordà');

    await waitFor(() => expect(api.getMunicipalities).toHaveBeenCalledWith('', 'Baix Empordà'));
    const municipality = screen.getByRole('combobox', { name: 'Municipi' });
    await user.type(municipality, 'palafragell');
    expect(screen.getByText('Cap municipi coincideix amb la cerca.')).toBeInTheDocument();
    await user.clear(municipality);
    await user.type(municipality, 'palafrugell');
    await user.click(await screen.findByRole('option', { name: 'Palafrugell · Baix Empordà · Girona' }));
    expect(JSON.parse(localStorage.getItem(LOCATION_PREFERENCE_KEY))).toEqual({ version: 1, location: { comarca: 'Baix Empordà', municipality: 'Palafrugell' } });
    await user.click(screen.getByRole('button', { name: 'Música' }));
    await user.click(screen.getByRole('checkbox', { name: 'Només plans gratuïts' }));
    await waitFor(() => expect(onSearch).toHaveBeenCalledWith(expect.objectContaining({
      comarca: 'Baix Empordà',
      municipality: 'Palafrugell',
      category: 'musica',
      free: 'true',
      q: 'rock',
    })));
  });

  it('debounces text-only searches and omits an empty query', async () => {
    const user = userEvent.setup();
    const onSearch = vi.fn();
    render(<SearchFilters onSearch={onSearch} />);
    const input = screen.getByRole('searchbox', { name: 'Cerca' });
    await user.type(input, 'weeknd');
    await waitFor(() => expect(onSearch).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'weeknd' })));
    await user.clear(input);
    await user.type(input, '   ');
    await waitFor(() => expect(onSearch).toHaveBeenLastCalledWith(expect.objectContaining({ q: '' })));
  });

  it('renders the complete Spanish search label and placeholder', async () => {
    await i18n.changeLanguage('es');
    render(<SearchFilters onSearch={vi.fn()} />);
    expect(screen.getByRole('searchbox', { name: 'Búsqueda' })).toHaveAttribute(
      'placeholder', 'Busca un concierto, una fiesta, una exposición...',
    );
  });

  it('supports keyboard selection and an integrated clear action', async () => {
    const user = userEvent.setup();
    const onSearch = vi.fn();
    render(<SearchFilters onSearch={onSearch} />);
    const municipality = await screen.findByPlaceholderText('Busca qualsevol municipi');
    await user.click(municipality);
    await user.keyboard('{ArrowDown}{Enter}');
    expect(municipality).toHaveValue('Begur');
    const clear = screen.getByRole('button', { name: 'Esborrar el municipi seleccionat' });
    await user.click(clear);
    expect(municipality).toHaveValue('');
    expect(municipality).toHaveFocus();
    expect(localStorage.getItem(LOCATION_PREFERENCE_KEY)).toBeNull();
  });

  it('persists only explicit location changes, including dependent removals and global clearing', async () => {
    const user = userEvent.setup();
    render(<SearchFilters initialFilters={{ comarca: 'Baix Empordà', municipality: 'Begur' }} onSearch={vi.fn()} />);
    await screen.findByRole('option', { name: 'Girona' });
    expect(localStorage.getItem(LOCATION_PREFERENCE_KEY)).toBeNull();

    await user.selectOptions(screen.getByLabelText('Província'), 'Girona');
    expect(JSON.parse(localStorage.getItem(LOCATION_PREFERENCE_KEY))).toEqual({ version: 1, location: { province: 'Girona' } });
    expect(screen.getByLabelText('Comarca')).toHaveValue('Baix Empordà');
    await user.click(screen.getByRole('button', { name: 'Esborrar filtres' }));
    expect(localStorage.getItem(LOCATION_PREFERENCE_KEY)).toBeNull();
  });
});
