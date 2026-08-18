import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ca from './locales/ca/translation.json';
import es from './locales/es/translation.json';
import caLegal from './locales/ca/legal.json';
import esLegal from './locales/es/legal.json';

export const LANGUAGE_STORAGE_KEY = 'quefem.language';
const storedLanguage = typeof window !== 'undefined'
  ? window.localStorage.getItem(LANGUAGE_STORAGE_KEY)
  : null;
const initialLanguage = ['ca', 'es'].includes(storedLanguage) ? storedLanguage : 'ca';

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
