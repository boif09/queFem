const ICON_SYMBOLS = {
  'book-open': '⌁',
  theater: '◐',
  family: '✦',
  'party-popper': '✺',
  store: '◇',
  utensils: '◉',
  museum: '▦',
  music: '♪',
  tree: '♢',
  landmark: '▤',
  walking: '↟',
  frame: '▣',
  film: '◧',
  sparkles: '❖',
};

export function CategoryIcon({ icon, className = '' }) {
  return (
    <span className={`category-icon ${className}`} aria-hidden="true">
      {ICON_SYMBOLS[icon] || '✦'}
    </span>
  );
}
