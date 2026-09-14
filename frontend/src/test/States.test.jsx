import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import i18n from '../i18n.js';
import { ErrorState } from '../components/States.jsx';

describe('public error copy', () => {
  beforeEach(() => i18n.changeLanguage('ca'));

  it.each([
    ['ca', /No hem pogut carregar els plans\. Torna-ho a provar d.aqu. a uns moments\./],
    ['es', /No hemos podido cargar los planes\. Vuelve a intentarlo dentro de unos momentos\./],
  ])('keeps the %s load error visitor-oriented', async (language, message) => {
    await i18n.changeLanguage(language);
    render(<ErrorState onRetry={() => {}} />);
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(screen.getByRole('alert')).not.toHaveTextContent(/API/i);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });
});
