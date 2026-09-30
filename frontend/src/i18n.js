import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ca from './locales/ca/translation.json';
import es from './locales/es/translation.json';
import caLegal from './locales/ca/legal.json';
import esLegal from './locales/es/legal.json';

export const LANGUAGE_STORAGE_KEY = 'quefem.language';
const LANGUAGES = ['ca', 'es'];

// An explicit ?lang= (links from the embed widget) wins for this visit but is never stored: only the
// visitor's own choice in the language switcher is persisted.
export function resolveInitialLanguage({ search = '', stored = null } = {}) {
  const requested = new URLSearchParams(search).get('lang');
  if (LANGUAGES.includes(requested)) return requested;
  return LANGUAGES.includes(stored) ? stored : 'ca';
}

const initialLanguage = typeof window !== 'undefined'
  ? resolveInitialLanguage({
    search: window.location.search,
    stored: window.localStorage.getItem(LANGUAGE_STORAGE_KEY),
  })
  : 'ca';

i18n
  .use(initReactI18next)
  .init({
    resources: {
      ca: { translation: { ...ca, legal: caLegal } },
      es: { translation: { ...es, legal: esLegal } },
    },
    lng: initialLanguage,
    fallbackLng: 'ca',
    supportedLngs: ['ca', 'es'],
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });

export default i18n;
