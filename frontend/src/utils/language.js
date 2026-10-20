export const UI_LANGUAGES = ['ca', 'es', 'en'];

export function uiLanguage(i18n) {
  const resolved = i18n.resolvedLanguage || '';
  if (resolved.startsWith('es')) return 'es';
  if (resolved.startsWith('en')) return 'en';
  return 'ca';
}

// Plans are only stored in Catalan and Spanish. English is a UI-only language, so the API is asked for
// Spanish text, which falls back to the original (mostly Catalan) when no Spanish text exists.
export function contentLanguage(language) {
  return language === 'en' ? 'es' : language;
}

export function categoryName(category, language, t) {
  if (language === 'en') {
    return t(`categories.${category.slug}`, { defaultValue: category.name_es || category.name_ca });
  }
  return language === 'es'
    ? (category.name_es || category.name_ca)
    : (category.name_ca || category.name_es);
}
