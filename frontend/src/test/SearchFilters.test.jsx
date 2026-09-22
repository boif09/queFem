import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => { resolve = nextResolve; reject = nextReject; });
  return { promise, resolve, reject };
}

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

    await user.click(screen.getByRole('combobox', { name: /omarca/ }));

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

  it('can hide the date section while retaining it by default', () => {
    const { rerender } = render(<SearchFilters onSearch={vi.fn()} hideDateSection />);
    expect(document.querySelector('.filter-section-date')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Data')).not.toBeInTheDocument();
    rerender(<SearchFilters onSearch={vi.fn()} />);
    expect(document.querySelector('.filter-section-date')).toBeInTheDocument();
    expect(screen.getByLabelText('Data')).toBeInTheDocument();
  });

  it('supports keyboard selection and an integrated clear action', async () => {
    const user = userEvent.setup();
    const onSearch = vi.fn();
    render(<SearchFilters onSearch={onSearch} />);
    const municipality = await screen.findByPlaceholderText('Busca qualsevol municipi');
    await user.click(municipality);
    await screen.findByRole('option', { name: /Begur/ });
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

  it('marks the active quick date with aria-pressed and the selected visual state', async () => {
    const user = userEvent.setup();
    render(<SearchFilters onSearch={vi.fn()} />);
    for (const name of [/Avui/, /Dem/, /Aquest cap de setmana/]) {
      const button = screen.getByRole('button', { name });
      await user.click(button);
      expect(button).toHaveAttribute('aria-pressed', 'true');
      expect(button).toHaveClass('is-selected');
    }
  });

  it('clears quick-date selection after a manual date change or clearing filters', async () => {
    const user = userEvent.setup();
    render(<SearchFilters onSearch={vi.fn()} />);
    const today = screen.getByRole('button', { name: 'Avui' });
    await user.click(today);
    expect(today).toHaveAttribute('aria-pressed', 'true');
    fireEvent.change(screen.getByLabelText('Data'), { target: { value: '2099-01-01' } });
    expect(today).toHaveAttribute('aria-pressed', 'false');
    await user.click(screen.getByRole('button', { name: 'Esborrar filtres' }));
    expect(today).toHaveAttribute('aria-pressed', 'false');
  });

  it('deduplicates repeated municipality requests for the same pending and completed scope', async () => {
    const pending = deferred();
    api.getMunicipalities.mockReturnValueOnce(pending.promise);
    render(<SearchFilters onSearch={vi.fn()} />);
    const municipality = screen.getByPlaceholderText('Busca qualsevol municipi');
    await waitFor(() => expect(municipality).not.toBeDisabled());

    fireEvent.focus(municipality);
    fireEvent.blur(municipality);
    fireEvent.focus(municipality);
    expect(api.getMunicipalities).toHaveBeenCalledTimes(1);

    pending.resolve({ data: [{ municipality: 'Begur', comarca: 'Baix Emporda', province: 'Girona' }] });
    await screen.findByRole('option', { name: /Begur/ });
    fireEvent.blur(municipality);
    fireEvent.focus(municipality);
    expect(api.getMunicipalities).toHaveBeenCalledTimes(1);
  });

  it('retries a failed municipality request for the same scope', async () => {
    api.getMunicipalities.mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ data: [{ municipality: 'Begur', comarca: 'Baix Emporda', province: 'Girona' }] });
    render(<SearchFilters onSearch={vi.fn()} />);
    const municipality = screen.getByPlaceholderText('Busca qualsevol municipi');
    await waitFor(() => expect(municipality).not.toBeDisabled());

    fireEvent.focus(municipality);
    await screen.findByRole('alert');
    fireEvent.blur(municipality);
    fireEvent.focus(municipality);
    await screen.findByRole('option', { name: /Begur/ });
    expect(api.getMunicipalities).toHaveBeenCalledTimes(2);
  });

  it('keeps newer municipality results when a previous scope resolves late', async () => {
    const first = deferred();
    const second = deferred();
    api.getMunicipalities.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const user = userEvent.setup();
    render(<SearchFilters onSearch={vi.fn()} />);
    const municipality = screen.getByPlaceholderText('Busca qualsevol municipi');
    await waitFor(() => expect(municipality).not.toBeDisabled());

    fireEvent.focus(municipality);
    await user.selectOptions(screen.getByRole('combobox', { name: /rov/ }), 'Girona');
    fireEvent.blur(municipality);
    fireEvent.focus(municipality);
    await waitFor(() => expect(api.getMunicipalities).toHaveBeenLastCalledWith('Girona', ''));
    expect(api.getMunicipalities).toHaveBeenCalledTimes(2);

    second.resolve({ data: [{ municipality: 'Girona', comarca: 'GironÃ¨s', province: 'Girona' }] });
    await screen.findByRole('option', { name: /^Girona .*/ });
    first.resolve({ data: [{ municipality: 'Barcelona', comarca: 'Barcelones', province: 'Barcelona' }] });
    await Promise.resolve();
    expect(screen.queryByRole('option', { name: /^Barcelona .*/ })).not.toBeInTheDocument();
  });

  it('keeps a restored resolved comarca scope active when another scope resolves late', async () => {
    const resolvedA = deferred();
    const pendingB = deferred();
    api.getComarques.mockReturnValueOnce(resolvedA.promise).mockReturnValueOnce(pendingB.promise);
    const user = userEvent.setup();
    render(<SearchFilters onSearch={vi.fn()} />);

    const province = screen.getByRole('combobox', { name: /rov/ });
    const comarca = screen.getByLabelText('Comarca');
    await waitFor(() => expect(province).not.toBeDisabled());
    await user.click(comarca);
    await waitFor(() => expect(api.getComarques).toHaveBeenCalledWith(''));
    resolvedA.resolve({ data: [{ comarca: 'Comarca A', province: 'Barcelona' }] });
    await screen.findByRole('option', { name: 'Comarca A' });

    await user.selectOptions(province, 'Girona');
    await waitFor(() => expect(api.getComarques).toHaveBeenLastCalledWith('Girona'));
    await user.selectOptions(province, '');
    expect(screen.getByRole('option', { name: 'Comarca A' })).toBeInTheDocument();
    expect(api.getComarques).toHaveBeenCalledTimes(2);

    await act(async () => {
      pendingB.resolve({ data: [{ comarca: 'Comarca B', province: 'Girona' }] });
      await pendingB.promise;
    });
    expect(screen.queryByRole('option', { name: 'Comarca B' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Comarca A' })).toBeInTheDocument();
  });

  it('prevents stale deep-link comarca responses from replacing a newer scope', async () => {
    const first = deferred();
    const second = deferred();
    api.getComarques.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { rerender } = render(<SearchFilters initialFilters={{ province: 'Old', comarca: 'Old comarca' }} onSearch={vi.fn()} />);
    await waitFor(() => expect(api.getComarques).toHaveBeenCalledWith('Old'));
    rerender(<SearchFilters initialFilters={{ province: 'New', comarca: 'New comarca' }} onSearch={vi.fn()} />);
    await waitFor(() => expect(api.getComarques).toHaveBeenCalledWith('New'));

    second.resolve({ data: [{ comarca: 'New comarca', province: 'New' }] });
    await screen.findByRole('option', { name: 'New comarca' });
    first.resolve({ data: [{ comarca: 'Old comarca', province: 'Old' }] });
    await Promise.resolve();
    expect(screen.queryByRole('option', { name: 'Old comarca' })).not.toBeInTheDocument();
  });

  it('matches municipality search against the municipality name only, not its comarca/province', async () => {
    api.getMunicipalities.mockResolvedValue({
      data: [
        { municipality: 'Barcelona', comarca: 'Barcelonès', province: 'Barcelona' },
        { municipality: 'Alella', comarca: 'Maresme', province: 'Barcelona' },
        { municipality: 'Sabadell', comarca: 'Vallès Occidental', province: 'Barcelona' },
        { municipality: 'Rubí', comarca: 'Vallès Occidental', province: 'Barcelona' },
      ],
    });
    const user = userEvent.setup();
    render(<SearchFilters onSearch={vi.fn()} />);
    const municipality = await screen.findByPlaceholderText('Busca qualsevol municipi');

    await user.click(municipality);
    await user.type(municipality, 'barce');
    expect(await screen.findByRole('option', { name: /^Barcelona /})).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /^Alella /})).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /^Sabadell /})).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /^Rubí /})).not.toBeInTheDocument();

    await user.clear(municipality);
    await user.type(municipality, 'BARCE');
    expect(await screen.findByRole('option', { name: /^Barcelona /})).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /^Alella /})).not.toBeInTheDocument();

    await user.clear(municipality);
    await user.type(municipality, 'rubi');
    expect(await screen.findByRole('option', { name: /^Rubí /})).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /^Barcelona /})).not.toBeInTheDocument();

    await user.clear(municipality);
    await user.type(municipality, 'occ');
    expect(screen.getByText('Cap municipi coincideix amb la cerca.')).toBeInTheDocument();
  });

  it('restricts municipality name search to the province/comarca scope already loaded', async () => {
    api.getMunicipalities.mockResolvedValue({
      data: [{ municipality: 'Begur', comarca: 'Baix Empordà', province: 'Girona' }],
    });
    const user = userEvent.setup();
    render(<SearchFilters onSearch={vi.fn()} />);
    const province = screen.getByRole('combobox', { name: /rov/ });
    await waitFor(() => expect(province).not.toBeDisabled());

    await user.selectOptions(province, 'Girona');
    const municipality = screen.getByPlaceholderText('Busca qualsevol municipi');
    await user.click(municipality);
    await waitFor(() => expect(api.getMunicipalities).toHaveBeenLastCalledWith('Girona', ''));
    await user.type(municipality, 'begur');
    expect(await screen.findByRole('option', { name: /^Begur /})).toBeInTheDocument();

    await user.click(screen.getByRole('combobox', { name: /omarca/ }));
    await waitFor(() => expect(api.getComarques).toHaveBeenCalledWith('Girona'));
  });

  it('does not update after unmounting with a deep-link comarca request pending', async () => {
    const pending = deferred();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    api.getComarques.mockReturnValueOnce(pending.promise);

    const { unmount } = render(
      <SearchFilters
        initialFilters={{ province: 'Girona', comarca: 'Baix Emporda' }}
        onSearch={vi.fn()}
      />,
    );
    await waitFor(() => expect(api.getComarques).toHaveBeenCalledWith('Girona'));

    unmount();
    pending.resolve({ data: [{ comarca: 'Baix Emporda', province: 'Girona' }] });
    await Promise.resolve();
    await Promise.resolve();
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
