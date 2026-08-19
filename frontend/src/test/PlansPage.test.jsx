import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import i18n from '../i18n.js';
import { PlansPage } from '../pages/PlansPage.jsx';
import { api } from '../services/api.js';

vi.mock('../services/api.js', () => ({
  api: { getPlans: vi.fn() },
}));

describe('PlansPage', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    await i18n.changeLanguage('ca');
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
});
