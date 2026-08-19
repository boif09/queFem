import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
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

  it('uses an external image only when its reuse is explicitly allowed', () => {
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

    expect(document.querySelector('.plan-visual img')).toHaveAttribute(
      'src',
      'https://example.test/allowed.jpg',
    );
  });
});
