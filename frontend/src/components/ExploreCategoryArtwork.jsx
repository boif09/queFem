import { getExploreCategoryImage } from '../config/exploreCategoryImages.js';
import { CategoryIcon } from './CategoryIcon.jsx';

export function ExploreCategoryArtwork({ category, eager = false }) {
  const image = getExploreCategoryImage(category.slug);
  if (image) {
    return (
      <span className="explore-category-artwork explore-category-photo" aria-hidden="true">
        <img
          src={image.src}
          alt=""
          width="1200"
          height="800"
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          style={{ objectPosition: image.objectPosition }}
        />
      </span>
    );
  }
  return (
    <span className="explore-category-artwork" aria-hidden="true">
      <i /><i /><CategoryIcon icon={category.icon} />
    </span>
  );
}
