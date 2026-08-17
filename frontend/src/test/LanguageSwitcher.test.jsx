import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useTranslation } from 'react-i18next';
import i18n, { LANGUAGE_STORAGE_KEY } from '../i18n.js';
import { LanguageSwitcher } from '../components/LanguageSwitcher.jsx';

function TranslatedHeading() {
  const { t } = useTranslation();
  return <h1>{t('home.title')}</h1>;
}

describe('LanguageSwitcher', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('ca');
  });

  it('changes the whole interface from Catalan to Spanish and saves the preference', async () => {
    const user = userEvent.setup();
    render(<><LanguageSwitcher /><TranslatedHeading /></>);

    expect(screen.getByRole('heading', { name: 'Què et ve de gust fer?' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Castellano' }));

    expect(screen.getByRole('heading', { name: '¿Qué te apetece hacer?' })).toBeInTheDocument();
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('es');
    expect(document.documentElement.lang).toBe('es');
  });
});
