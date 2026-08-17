import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { LANGUAGE_STORAGE_KEY } from '../i18n.js';

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage?.startsWith('es') ? 'es' : 'ca';

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const selectLanguage = (nextLanguage) => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, nextLanguage);
    i18n.changeLanguage(nextLanguage);
  };

  return (
    <div className="language-switcher" role="group" aria-label={t('language.label')}>
      {['ca', 'es'].map((code) => (
        <button
          className={language === code ? 'is-active' : ''}
          key={code}
          type="button"
          aria-label={t(`language.${code}`)}
          aria-pressed={language === code}
          onClick={() => selectLanguage(code)}
        >
          <span className="language-short">{code.toUpperCase()}</span>
          <span className="language-long">{t(`language.${code}`)}</span>
        </button>
      ))}
    </div>
  );
}
