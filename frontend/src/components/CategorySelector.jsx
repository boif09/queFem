import { useTranslation } from 'react-i18next';
import { CategoryIcon } from './CategoryIcon.jsx';
import { categoryName, uiLanguage } from '../utils/language.js';

export function CategorySelector({ categories, selected, onChange, loading = false }) {
  const { t, i18n } = useTranslation();
  const language = uiLanguage(i18n);
  if (loading) return <p className="field-hint">{t('filters.loadingCategories')}</p>;
  return (
    <div className="category-grid">
      {categories.map((category) => {
        const name = categoryName(category, language, t);
        return (
          <button
            type="button"
            className={`category-choice${selected.includes(category.slug) ? ' is-selected' : ''}`}
            aria-pressed={selected.includes(category.slug)}
            key={category.slug}
            onClick={() => onChange(selected.includes(category.slug)
              ? selected.filter((slug) => slug !== category.slug)
              : [...selected, category.slug])}
          >
            <CategoryIcon icon={category.icon} />
            <span className="category-choice-label">{name}</span>
          </button>
        );
      })}
    </div>
  );
}
