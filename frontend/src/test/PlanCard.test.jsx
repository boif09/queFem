import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import i18n from '../i18n.js';
import { PlanCard } from '../components/PlanCard.jsx';

describe('PlanCard', () => {
  beforeEach(async () => i18n.changeLanguage('ca'));

  it('shows the useful summary without adding external imagery', () => {
    render(
      <MemoryRouter>
        <PlanCard plan={{
          id: 42,
          kind: 'event',
          title: 'Concert de tarda',
          start_date: '2026-08-22',
          end_date: '2026-08-22',
          permanent: false,
          free: true,
          image_url: 'https://example.test/not-authorized.jpg',
          image_reuse_allowed: false,
          municipality: 'Palafrugell',
          comarca: 'Baix Empordà',
          categories: [{ slug: 'musica', name: 'Música', icon: 'music' }],
        }} />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'Concert de tarda' })).toBeInTheDocument();
    expect(screen.getByText('Palafrugell · Baix Empordà')).toBeInTheDocument();
    expect(screen.getByText('Gratuït')).toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute('href', '/plans/42');
    expect(document.querySelector('img')).not.toBeInTheDocument();
    expect(document.querySelector('[data-pattern="musica"]')).toBeInTheDocument();
  });

  it('keeps long titles in the DOM and provides a generic visual fallback', () => {
    const title = 'Un títol extraordinàriament llarg que continua complet i accessible a la targeta';
    render(<MemoryRouter><PlanCard plan={{ id: 44, kind: 'activity', title, permanent: true, free: false, categories: [] }} /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    expect(document.querySelector('[data-pattern="activity"]')).toBeInTheDocument();
  });

  it('uses only the canonical API display image, never a raw source URL', () => {
    render(
      <MemoryRouter>
        <PlanCard plan={{
          id: 43,
          kind: 'event',
          title: 'Imatge autoritzada',
          start_date: '2026-08-22',
          end_date: '2026-08-22',
          permanent: false,
          free: false,
          image_url: 'https://example.test/allowed.jpg',
          image_reuse_allowed: true,
          categories: [{ slug: 'cultura', name: 'Cultura', icon: 'book-open' }],
        }} />
      </MemoryRouter>,
    );

    expect(document.querySelector('.plan-visual img')).not.toBeInTheDocument();
    expect(document.querySelector('[data-pattern="cultura"]')).toBeInTheDocument();
  });

  it('renders the controlled card image lazily and falls back to the category pattern on error', () => {
    render(
      <MemoryRouter>
        <PlanCard plan={{
          id: 45,
          kind: 'event',
          title: 'Concert amb foto',
          start_date: '2026-08-22',
          end_date: '2026-08-22',
          permanent: false,
          free: false,
          image: {
            url: '/api/media/ticketmaster/45', width: 640, height: 360,
            kind: 'official', source: 'ticketmaster',
          },
          categories: [{ slug: 'musica', name: 'Música', icon: 'music' }],
        }} />
      </MemoryRouter>,
    );

    const image = document.querySelector('.plan-visual img');
    expect(image).toHaveAttribute('src', '/api/media/ticketmaster/45');
    expect(image).toHaveAttribute('alt', '');
    expect(image).toHaveAttribute('loading', 'lazy');
    expect(image).toHaveAttribute('decoding', 'async');
    expect(image).not.toHaveAttribute('referrerpolicy');
    expect(image).toHaveAttribute('width', '640');
    expect(image).toHaveAttribute('height', '360');
    expect(document.querySelector('.plan-visual')).toHaveClass('has-image');
    fireEvent.error(image);
    expect(document.querySelector('.plan-visual img')).not.toBeInTheDocument();
    expect(document.querySelector('[data-pattern="musica"]')).toBeInTheDocument();
  });
});
