import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import i18n from '../i18n.js';
import { buildEventJsonLd, PlanDetailPage } from '../pages/PlanDetailPage.jsx';
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
    expect(screen.queryByTitle('Mapa de la ubicació')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Veure mapa/i }));
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
    await waitFor(() => expect(document.title).toBe('Festival de prova a Begur | Tens pla?'));
    expect(document.head.querySelector('link[rel="canonical"]')).toHaveAttribute('href', 'https://tenspla.cat/plans/7');
    await waitFor(() => expect(document.head.querySelector('script[data-tenspla-jsonld]')).toBeInTheDocument());
    const structuredData = JSON.parse(document.head.querySelector('script[data-tenspla-jsonld]').textContent);
    expect(structuredData).toMatchObject({
      '@context': 'https://schema.org', '@type': 'Event', name: 'Festival de prova',
      startDate: '2026-08-22', endDate: '2026-08-23', url: 'https://tenspla.cat/plans/7',
      location: {
        '@type': 'Place', name: 'Plaça Major',
        geo: { '@type': 'GeoCoordinates', latitude: 41.95, longitude: 3.2 },
      },
    });
    expect(structuredData).not.toHaveProperty('organizer');
    expect(structuredData).not.toHaveProperty('image');
    expect(structuredData).not.toHaveProperty('offers');
  });

  it('does not generate Event JSON-LD without a sufficiently reliable location', () => {
    expect(buildEventJsonLd({
      kind: 'event', title: 'Concert sense lloc', start_date: '2026-09-01',
      municipality: 'Barcelona', venue_name: null, address: null,
    }, 'https://tenspla.cat/plans/8', 'Informació factual.')).toBeNull();
  });

  it('does not generate Event JSON-LD without startDate', () => {
    expect(buildEventJsonLd({
      kind: 'event', title: 'Concert sense data', start_date: null,
      municipality: 'Barcelona', venue_name: 'Sala de prova', address: 'Carrer Major, 1',
    }, 'https://tenspla.cat/plans/9', 'Informació factual.')).toBeNull();
  });

  it('uses the next occurrence in recurring JSON-LD without an annual end date', () => {
    const jsonLd = buildEventJsonLd({
      kind: 'event', title: 'Recurrent', start_date: '2026-08-01', end_date: '2027-08-01',
      nextOccurrence: { localDate: '2026-09-10', localTime: '18:30' }, venue_name: 'Sala', address: 'Carrer 1',
    }, 'https://tenspla.cat/plans/12', 'Sessió recurrent.');
    expect(jsonLd).toMatchObject({ startDate: '2026-09-10T18:30:00' });
    expect(jsonLd).not.toHaveProperty('endDate');
  });

  it('keeps date-only recurring JSON-LD date-only', () => {
    const jsonLd = buildEventJsonLd({
      kind: 'event', title: 'Data única', start_date: '2026-08-01', end_date: '2027-08-01',
      nextOccurrence: { localDate: '2026-09-10', localTime: null }, venue_name: 'Sala', address: 'Carrer 1',
    }, 'https://tenspla.cat/plans/13', 'Sessió sense hora.');
    expect(jsonLd).toMatchObject({ startDate: '2026-09-10' });
    expect(jsonLd).not.toHaveProperty('endDate');
  });

  it('shows a prominent detail image and literal attribution only when provided', async () => {
    api.getPlan.mockResolvedValue({ data: {
      id: 10, kind: 'event', title: 'Concert Ticketmaster', start_date: '2026-09-01',
      end_date: '2026-09-01', permanent: false, free: false,
      venue_name: 'Sala Example', municipality: 'Barcelona',
      image: {
          url: '/api/media/ticketmaster/10', width: 1136, height: 639,
        kind: 'official', attribution: 'Crèdit literal Ticketmaster', source: 'ticketmaster',
      },
      categories: [{ slug: 'musica', name: 'Música', icon: 'music' }], sources: [],
    } });
    render(<MemoryRouter initialEntries={['/plans/10']}><Routes><Route path="/plans/:id" element={<PlanDetailPage />} /></Routes></MemoryRouter>);
    await screen.findByRole('heading', { name: 'Concert Ticketmaster' });
    const image = document.querySelector('.detail-visual img');
    expect(image).toHaveAttribute('src', '/api/media/ticketmaster/10');
    expect(image).toHaveAttribute('alt', '');
    expect(image).toHaveAttribute('decoding', 'async');
    expect(image).not.toHaveAttribute('referrerpolicy');
    expect(document.querySelector('.detail-visual')).toHaveClass('has-image');
    expect(screen.getByText('Crèdit literal Ticketmaster')).toBeInTheDocument();
    fireEvent.error(image);
    expect(document.querySelector('.detail-visual img')).not.toBeInTheDocument();
    expect(document.querySelector('[data-pattern="musica"]')).toBeInTheDocument();
    expect(screen.queryByText('Crèdit literal Ticketmaster')).not.toBeInTheDocument();
  });

  it('keeps the existing detail pattern and no attribution without an image', async () => {
    api.getPlan.mockResolvedValue({ data: {
      id: 11, kind: 'event', title: 'Pla sense foto', start_date: '2026-09-01',
      end_date: '2026-09-01', permanent: false, free: false, image: null,
      categories: [{ slug: 'cultura', name: 'Cultura', icon: 'book-open' }], sources: [],
    } });
    render(<MemoryRouter initialEntries={['/plans/11']}><Routes><Route path="/plans/:id" element={<PlanDetailPage />} /></Routes></MemoryRouter>);
    await screen.findByRole('heading', { name: 'Pla sense foto' });
    expect(document.querySelector('.detail-visual img')).not.toBeInTheDocument();
    expect(document.querySelector('[data-pattern="cultura"]')).toBeInTheDocument();
    expect(document.querySelector('.image-attribution')).not.toBeInTheDocument();
  });

  it('shows a localized generic disclosure and alt text without emitting Event.image', async () => {
    api.getPlan.mockResolvedValue({ data: {
      id: 12, kind: 'event', title: 'Taller de prova', start_date: '2026-09-01', end_date: '2026-09-01',
      permanent: false, free: false, venue_name: 'Ateneu', address: 'Carrer Major, 1', municipality: 'Girona',
      image: {
        url: '/media/fallbacks/card/cultura/cultura-01.webp', kind: 'generic', source: 'tenspla-fallback',
        alt: 'Imatge orientativa: Un taller artístic.', photographer: 'Fotògrafa de prova',
        sourcePage: 'https://www.pexels.com/photo/prova-1/',
      },
      categories: [{ slug: 'cultura', name: 'Cultura', icon: 'book-open' }], sources: [],
    } });
    render(<MemoryRouter initialEntries={['/plans/12']}><Routes><Route path="/plans/:id" element={<PlanDetailPage />} /></Routes></MemoryRouter>);
    await screen.findByRole('heading', { name: 'Taller de prova' });
    expect(document.querySelector('.detail-visual img')).toHaveAttribute('alt', 'Imatge orientativa: Un taller artístic.');
    expect(document.querySelector('.generic-image-disclosure')).toHaveTextContent('Imatge orientativa');
    expect(screen.getByRole('link', { name: 'Foto de Fotògrafa de prova a Pexels' })).toHaveAttribute('href', 'https://www.pexels.com/photo/prova-1/');
    await waitFor(() => expect(document.head.querySelector('script[data-tenspla-jsonld]')).toBeInTheDocument());
    const structuredData = JSON.parse(document.head.querySelector('script[data-tenspla-jsonld]').textContent);
    expect(structuredData).not.toHaveProperty('image');
  });

  it('keeps an explicitly eligible official image in JSON-LD', () => {
    const jsonLd = buildEventJsonLd({
      title: 'Concert oficial', start_date: '2026-09-01', venue_name: 'Sala', address: 'Carrer 1',
      image: { kind: 'official', url: '/api/media/fever/1', jsonld_event_image_eligible: true },
    }, 'https://tenspla.cat/plans/14', 'Sessió oficial.');
    expect(jsonLd.image).toBe('https://tenspla.cat/api/media/fever/1');
  });

  it('translates the generic disclosure into Spanish', async () => {
    await i18n.changeLanguage('es');
    api.getPlan.mockResolvedValue({ data: {
      id: 15, kind: 'event', title: 'Taller', start_date: '2026-09-01', end_date: '2026-09-01',
      permanent: false, free: false, venue_name: 'Ateneo', address: 'Calle Mayor, 1', municipality: 'Girona',
      image: { url: '/media/fallbacks/cultura/cultura-01.webp', kind: 'generic', alt: 'Imagen orientativa: Un taller.', photographer: 'Fotógrafo de prueba', sourcePage: 'https://www.pexels.com/photo/prueba-1/' },
      categories: [{ slug: 'cultura', name: 'Cultura', icon: 'book-open' }], sources: [],
    } });
    render(<MemoryRouter initialEntries={['/plans/15']}><Routes><Route path="/plans/:id" element={<PlanDetailPage />} /></Routes></MemoryRouter>);
    await screen.findByRole('heading', { name: 'Taller' });
    expect(document.querySelector('.generic-image-disclosure')).toHaveTextContent('Imagen orientativa');
    expect(screen.getByRole('link', { name: 'Foto de Fotógrafo de prueba en Pexels' })).toHaveAttribute('href', 'https://www.pexels.com/photo/prueba-1/');
  });
});
