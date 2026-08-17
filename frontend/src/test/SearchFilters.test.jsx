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
    }));
  });
});
