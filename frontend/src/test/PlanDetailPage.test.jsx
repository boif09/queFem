import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import i18n from '../i18n.js';
import { PlanDetailPage } from '../pages/PlanDetailPage.jsx';
import { api } from '../services/api.js';

vi.mock('../services/api.js', () => ({
  api: { getPlan: vi.fn() },
}));

describe('PlanDetailPage', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    await i18n.changeLanguage('ca');
  });

  it('renders complete plan data and mandatory source attribution', async () => {
    api.getPlan.mockResolvedValue({ data: {
      id: 7,
      kind: 'event',
      title: 'Festival de prova',
      subtitle: 'Una tarda cultural',
      description: 'Descripció original del festival.',
      start_date: '2026-08-22',
      end_date: '2026-08-23',
      permanent: false,
      free: true,
      schedule_text: 'De 18 a 22 h',
      venue_name: 'Plaça Major',
      address: 'Carrer Major, 1',
      municipality: 'Begur',
      comarca: 'Baix Empordà',
      locality: 'Centre',
      latitude: 41.95,
      longitude: 3.2,
      website_url: 'https://example.test/festival',
      ticket_url: null,
      categories: [{ slug: 'cultura', name: 'Cultura', icon: 'culture' }],
      sources: [{
        name: 'Agenda Cultural de Catalunya',
        publisher: 'Generalitat de Catalunya. Departament de Cultura',
        source_url: 'https://example.test/source',
        attribution_text: 'Generalitat de Catalunya. Departament de Cultura',
        source_updated_at: '2026-08-17T08:00:00.000Z',
      }],
    } });
    render(
      <MemoryRouter initialEntries={['/plans/7']}>
        <Routes><Route path="/plans/:id" element={<PlanDetailPage />} /></Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Festival de prova' })).toBeInTheDocument();
    expect(screen.getByText('Descripció original del festival.')).toBeInTheDocument();
    expect(screen.getByText('Plaça Major')).toBeInTheDocument();
    expect(screen.getByTitle('Mapa de la ubicació')).toHaveAttribute(
      'src',
      expect.stringContaining('openstreetmap.org/export/embed.html'),
    );
    expect(screen.getByRole('link', { name: 'Obrir a Google Maps' })).toHaveAttribute(
      'href',
      'https://www.google.com/maps/search/?api=1&query=41.95%2C3.2',
    );
    expect(screen.getByRole('heading', { name: 'Font de la informació' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Agenda Cultural de Catalunya' })).toBeInTheDocument();
    expect(screen.getAllByText('Generalitat de Catalunya. Departament de Cultura')).toHaveLength(2);
    expect(screen.getByRole('link', { name: /Consultar la font original/i })).toHaveAttribute('href', 'https://example.test/source');
    expect(api.getPlan).toHaveBeenCalledWith('7', 'ca');
  });
});
