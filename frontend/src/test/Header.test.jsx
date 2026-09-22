import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import i18n from '../i18n.js';
import { Header } from '../components/Header.jsx';

describe('Header', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('ca');
  });

  it('renders the discovery landings as real navigation links', () => {
    render(<MemoryRouter><Header /></MemoryRouter>);

    expect(screen.getByRole('link', { name: 'Avui' })).toHaveAttribute('href', '/avui');
    expect(screen.getByRole('link', { name: 'Cap de setmana' })).toHaveAttribute('href', '/cap-de-setmana');
  });
});
