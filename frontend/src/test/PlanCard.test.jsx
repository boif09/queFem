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
  });
});
