import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import i18n from '../i18n.js';
import { Header } from '../components/Header.jsx';
import { PlanCard } from '../components/PlanCard.jsx';
import { ShareButton } from '../components/ShareButton.jsx';
import { FavoritesPage } from '../pages/FavoritesPage.jsx';
import { api } from '../services/api.js';
import { addFavorite, FAVORITES_KEY, readFavorites } from '../utils/favorites.js';

vi.mock('../services/api.js', () => ({ api: { getPlan: vi.fn() } }));

const plan = (id, title) => ({
  id,
  kind: 'event',
  title,
  start_date: '2026-11-07',
  end_date: '2026-11-07',
  permanent: false,
  free: true,
  municipality: 'Girona',
  categories: [],
});

function notFound() {
  return Object.assign(new Error('not found'), { status: 404 });
}

describe('favourite button', () => {
  beforeEach(async () => i18n.changeLanguage('ca'));

  it('saves and removes a plan from a card without following the card link, and updates the header count', () => {
    render(<MemoryRouter><Header /><PlanCard plan={plan(42, 'Concert de tarda')} /></MemoryRouter>);
    const button = screen.getByRole('button', { name: 'Desa «Concert de tarda» als preferits' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('link', { name: 'Preferits' })).toHaveAttribute('href', '/preferits');

    fireEvent.click(button);
    expect(screen.getByRole('button', { name: 'Treu «Concert de tarda» dels preferits' })).toHaveAttribute('aria-pressed', 'true');
    expect(readFavorites().map((item) => item.id)).toEqual(['42']);
    expect(screen.getByRole('link', { name: 'Preferits: 1 pla desat' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Treu «Concert de tarda» dels preferits' }));
    expect(window.localStorage.getItem(FAVORITES_KEY)).toBeNull();
  });
});

describe('favourites page', () => {
  beforeEach(async () => {
    vi.mocked(api.getPlan).mockReset();
    await i18n.changeLanguage('ca');
  });

  const renderPage = (path = '/preferits') => render(
    <MemoryRouter initialEntries={[path]}><Routes><Route path="/preferits" element={<FavoritesPage />} /><Route path="/favoritos" element={<FavoritesPage />} /></Routes></MemoryRouter>,
  );

  it('explains how to save plans when there are none', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Encara no has desat cap pla' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Explora plans' })).toHaveAttribute('href', '/plans');
    expect(api.getPlan).not.toHaveBeenCalled();
  });

  it('refreshes each saved plan, lists the ones that are gone and moves merged plans to their canonical id', async () => {
    addFavorite({ id: 'gone', title: 'Fira acabada' });
    addFavorite({ id: 'alias-1', title: 'Mercat' });
    addFavorite({ id: 5, title: 'Concert' });
    vi.mocked(api.getPlan).mockImplementation(async (id) => {
      if (id === 'gone') throw notFound();
      if (id === 'alias-1') return { data: plan(9, 'Mercat de Nadal') };
      return { data: plan(5, 'Concert') };
    });
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Concert' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Mercat de Nadal' })).toBeInTheDocument();
    const gone = await screen.findByRole('region', { name: 'Ja no disponibles' });
    expect(within(gone).getByText('Fira acabada')).toBeInTheDocument();
    expect(api.getPlan).toHaveBeenCalledWith('5', 'ca');
    await waitFor(() => expect(readFavorites().map((item) => item.id)).toEqual(['5', '9', 'gone']));

    fireEvent.click(within(gone).getByRole('button', { name: 'Treu-lo' }));
    expect(readFavorites().map((item) => item.id)).toEqual(['5', '9']);
    expect(screen.queryByRole('region', { name: 'Ja no disponibles' })).not.toBeInTheDocument();
  });

  it('offers a retry when a plan cannot be loaded', async () => {
    addFavorite({ id: 5, title: 'Concert' });
    vi.mocked(api.getPlan).mockRejectedValueOnce(Object.assign(new Error('offline'), { status: 0 }));
    vi.mocked(api.getPlan).mockResolvedValueOnce({ data: plan(5, 'Concert') });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Tornar-ho a provar' }));
    expect(await screen.findByRole('heading', { name: 'Concert' })).toBeInTheDocument();
    expect(api.getPlan).toHaveBeenCalledTimes(2);
  });

  it('reloads a plan that is removed and saved again', async () => {
    addFavorite({ id: 5, title: 'Concert' });
    vi.mocked(api.getPlan).mockResolvedValueOnce({ data: plan(5, 'Concert') });
    vi.mocked(api.getPlan).mockResolvedValueOnce({ data: plan(5, 'Concert ajornat') });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Treu «Concert» dels preferits' }));
    expect(await screen.findByRole('heading', { name: 'Encara no has desat cap pla' })).toBeInTheDocument();
    act(() => { addFavorite({ id: 5, title: 'Concert' }); });
    expect(await screen.findByRole('heading', { name: 'Concert ajornat' })).toBeInTheDocument();
    expect(api.getPlan).toHaveBeenCalledTimes(2);
  });
});

describe('share button', () => {
  beforeEach(async () => i18n.changeLanguage('ca'));

  it('uses the native share sheet when available and ignores a cancelled share', async () => {
    const share = vi.fn().mockRejectedValueOnce(Object.assign(new Error('cancel'), { name: 'AbortError' })).mockResolvedValueOnce();
    render(<ShareButton planId={1} title="Concert" url="https://tenspla.cat/plans/1" target={{ navigator: { share } }} />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Comparteix' })));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Comparteix' })));
    expect(share).toHaveBeenCalledWith({ title: 'Concert', url: 'https://tenspla.cat/plans/1' });
    expect(screen.getByRole('status')).toHaveTextContent('');
  });

  it('copies the link when there is no share sheet, and shows it to copy by hand when it can do neither', async () => {
    const writeText = vi.fn().mockResolvedValue();
    const { unmount } = render(<ShareButton planId={1} title="Concert" url="https://tenspla.cat/plans/1" target={{ navigator: { clipboard: { writeText } } }} />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Comparteix' })));
    expect(writeText).toHaveBeenCalledWith('https://tenspla.cat/plans/1');
    expect(screen.getByRole('status')).toHaveTextContent('Enllaç copiat');
    unmount();

    render(<ShareButton planId={1} title="Concert" url="https://tenspla.cat/plans/1" target={{ navigator: {} }} />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Comparteix' })));
    expect(screen.getByRole('textbox', { name: 'Enllaç del pla' })).toHaveValue('https://tenspla.cat/plans/1');
  });

  it('clears an earlier failure when sharing again works', async () => {
    const writeText = vi.fn().mockRejectedValueOnce(new Error('blocked')).mockResolvedValueOnce();
    render(<ShareButton planId={1} title="Concert" url="https://tenspla.cat/plans/1" target={{ navigator: { clipboard: { writeText } } }} />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Comparteix' })));
    expect(screen.getByRole('textbox', { name: 'Enllaç del pla' })).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Comparteix' })));
    expect(screen.queryByRole('textbox', { name: 'Enllaç del pla' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Enllaç copiat');
  });

  it('shows the link to copy by hand when the clipboard is blocked', async () => {
    const writeText = vi.fn().mockRejectedValue(Object.assign(new Error('blocked'), { name: 'NotAllowedError' }));
    render(<ShareButton planId={1} title="Concert" url="https://tenspla.cat/plans/1" target={{ navigator: { clipboard: { writeText } } }} />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Comparteix' })));
    expect(screen.getByRole('status')).toHaveTextContent("No s'ha pogut copiar automàticament");
    expect(screen.getByRole('textbox', { name: 'Enllaç del pla' })).toHaveValue('https://tenspla.cat/plans/1');
  });
});
