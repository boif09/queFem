import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../i18n.js';
import { SearchFilters } from '../components/SearchFilters.jsx';
import { api } from '../services/api.js';

vi.mock('../services/api.js', () => ({
  api: {
    getComarques: vi.fn(),
    getMunicipalities: vi.fn(),
    getCategories: vi.fn(),
  },
}));

describe('SearchFilters', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    await i18n.changeLanguage('ca');
    api.getComarques.mockResolvedValue({ data: ['Baix Empordà', 'Barcelonès'] });
    api.getCategories.mockResolvedValue({
      data: [{ slug: 'musica', name_ca: 'Música', name_es: 'Música', icon: 'music' }],
    });
    api.getMunicipalities.mockResolvedValue({ data: ['Begur', 'Palafrugell'] });
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

    await waitFor(() => expect(api.getMunicipalities).toHaveBeenCalledWith('Baix Empordà'));
    await screen.findByRole('option', { name: 'Palafrugell' });
    await user.selectOptions(screen.getByLabelText('Municipi'), 'Palafrugell');
    await user.click(screen.getByRole('button', { name: 'Música' }));
    await user.click(screen.getByRole('checkbox', { name: 'Només plans gratuïts' }));
    await user.click(screen.getByRole('button', { name: /Buscar plans/i }));

    expect(onSearch).toHaveBeenCalledWith(expect.objectContaining({
      comarca: 'Baix Empordà',
      municipality: 'Palafrugell',
      category: 'musica',
      free: 'true',
      q: 'rock',
    }));
  });

  it('submits text-only searches with Enter and omits an empty query', async () => {
    const user = userEvent.setup();
    const onSearch = vi.fn();
    render(<SearchFilters onSearch={onSearch} />);
    const input = screen.getByRole('searchbox', { name: 'Cerca' });
    await user.type(input, 'weeknd{Enter}');
    expect(onSearch).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'weeknd' }));
    await user.clear(input);
    await user.type(input, '   {Enter}');
    expect(onSearch).toHaveBeenLastCalledWith(expect.objectContaining({ q: '' }));
  });

  it('renders the complete Spanish search label and placeholder', async () => {
    await i18n.changeLanguage('es');
    render(<SearchFilters onSearch={vi.fn()} />);
    expect(screen.getByRole('searchbox', { name: 'Búsqueda' })).toHaveAttribute(
      'placeholder', 'Busca un concierto, una fiesta, una exposición...',
    );
  });
});
