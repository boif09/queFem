export const FAVORITES_PATHS = ['/preferits', '/favoritos'];

export function favoritesPath(language) {
  return language === 'es' ? '/favoritos' : '/preferits';
}
