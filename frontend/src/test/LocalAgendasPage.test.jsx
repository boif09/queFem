import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import i18n from '../i18n.js';
import { AppRoutes } from '../App.jsx';

vi.mock('../services/api.js', () => ({
  api: {
    getSources: vi.fn(), getPlans: vi.fn(), getPlan: vi.fn(),
    getProvinces: vi.fn(), getComarques: vi.fn(), getMunicipalities: vi.fn(), getCategories: vi.fn(),
  },
}));

function renderRoute(path) {
  return render(<MemoryRouter initialEntries={[path]}><AppRoutes /></MemoryRouter>);
}

describe('local agendas page', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('ca');
  });
  afterEach(() => { delete window.umami; });

  it('lists the recommended agenda, the criteria and a contact link', async () => {
    window.umami = { track: vi.fn() };
    renderRoute('/agendes-locals');
    const main = within(screen.getByRole('main'));
    expect(main.getByRole('heading', { level: 1, name: 'Agendes locals que recomanem' })).toBeInTheDocument();
    expect(main.getByRole('heading', { level: 3, name: 'Terrassa amb plans' })).toBeInTheDocument();
    expect(main.getByText('No té anuncis.')).toBeInTheDocument();
    expect(main.getByText('Només l’enllacem: no copiem ni importem els seus plans.')).toBeInTheDocument();

    const visit = main.getByRole('link', { name: /Visita Terrassa amb plans/ });
    expect(visit).toHaveAttribute('href', 'https://terrassambplans.cat/');
    expect(visit).toHaveAttribute('target', '_blank');
    visit.addEventListener('click', (event) => event.preventDefault());
    await userEvent.click(visit);
    expect(window.umami.track).toHaveBeenCalledWith('local_agenda_click', {
      agenda: 'terrassa-amb-plans', placement: 'directory', language: 'ca',
    });

    const mailLinks = main.getAllByRole('link').filter((link) => link.getAttribute('href')?.startsWith('mailto:'));
    expect(mailLinks).toHaveLength(2);
    for (const link of mailLinks) {
      expect(link.getAttribute('href')).toBe(`mailto:contacte@tenspla.cat?subject=${encodeURIComponent('Agenda local per a Tens pla?')}`);
    }
    expect(document.head.querySelector('link[rel="canonical"]')).toHaveAttribute('href', 'https://tenspla.cat/agendes-locals');
    expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute('content', 'index,follow');
    expect(screen.getByRole('link', { name: 'Agendes locals' })).toHaveAttribute('href', '/agendes-locals');
  });

  it('serves the Spanish alias and links the footer to it', async () => {
    await i18n.changeLanguage('es');
    renderRoute('/agendas-locales');
    expect(screen.getByRole('heading', { level: 1, name: 'Agendas locales que recomendamos' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Agendas locales' })).toHaveAttribute('href', '/agendas-locales');
    expect(document.head.querySelector('link[rel="canonical"]')).toHaveAttribute('href', 'https://tenspla.cat/agendes-locals');
  });
});
