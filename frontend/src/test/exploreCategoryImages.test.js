import { describe, expect, it } from 'vitest';
import { HOME_EXPLORE_LIMIT, HOME_EXPLORE_ORDER, getExploreCategoryImage, homeExploreCategories } from '../config/exploreCategoryImages.js';

const category = (slug) => ({ slug, name_ca: slug, name_es: slug, icon: 'x' });
// The catalogue as the API returns it: alphabetical by slug.
const CATALOGUE = ['cinema', 'cultura', 'espectacles', 'experiencies', 'exposicions', 'familia', 'festes', 'fires-mercats',
  'gastronomia', 'museus', 'musica', 'natura', 'patrimoni', 'senderisme'].map(category);

describe('home explore categories', () => {
  it('shows the editorial order instead of the first eight slugs alphabetically', () => {
    const slugs = homeExploreCategories(CATALOGUE).map(({ slug }) => slug);
    expect(slugs).toEqual(['cultura', 'espectacles', 'musica', 'familia', 'festes', 'gastronomia', 'patrimoni', 'natura']);
    expect(slugs).toHaveLength(HOME_EXPLORE_LIMIT);
  });

  it('skips a category missing from the catalogue and fills the rest in catalogue order', () => {
    const withoutMusic = CATALOGUE.filter(({ slug }) => slug !== 'musica');
    const slugs = homeExploreCategories(withoutMusic).map(({ slug }) => slug);
    expect(slugs).toEqual(['cultura', 'espectacles', 'familia', 'festes', 'gastronomia', 'patrimoni', 'natura', 'cinema']);
  });

  it('works with a short catalogue and never repeats a category', () => {
    expect(homeExploreCategories([category('natura'), category('cultura')]).map(({ slug }) => slug)).toEqual(['cultura', 'natura']);
    expect(homeExploreCategories([]).length).toBe(0);
    const slugs = homeExploreCategories(CATALOGUE).map(({ slug }) => slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('only lists categories that exist in the catalogue and keeps photos for the ones that have them', () => {
    HOME_EXPLORE_ORDER.forEach((slug) => expect(CATALOGUE.map((entry) => entry.slug), slug).toContain(slug));
    ['cultura', 'espectacles', 'musica', 'familia', 'festes', 'gastronomia', 'patrimoni', 'natura']
      .forEach((slug) => expect(getExploreCategoryImage(slug)?.src, slug).toMatch(/^\/images\/explore\//));
    ['bicicleta', 'miradors'].forEach((slug) => expect(getExploreCategoryImage(slug), slug).toBeNull());
  });
});
