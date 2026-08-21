import { useTranslation } from 'react-i18next';
import { CategoryIcon } from './CategoryIcon.jsx';

export function CategorySelector({ categories, selected, onChange, loading = false }) {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage?.startsWith('es') ? 'es' : 'ca';
  if (loading) return <p className="field-hint">{t('filters.loadingCategories')}</p>;
  return (
    <div className="category-grid">
      {categories.map((category) => {
        const name = language === 'es'
          ? (category.name_es || category.name_ca)
          : (category.name_ca || category.name_es);
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
            <span>{name}</span>
          </button>
        );
      })}
    </div>
  );
}
