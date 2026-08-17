const ICON_SYMBOLS = {
  bike: '◒',
  'book-open': '⌁',
  theater: '◐',
  family: '✦',
  'party-popper': '✺',
  store: '◇',
  utensils: '◉',
  binoculars: '⌾',
  monument: '▥',
  mountain: '△',
  museum: '▦',
  music: '♪',
  tree: '♢',
  trees: '♧',
  landmark: '▤',
  'umbrella-beach': '◡',
  houses: '⌂',
  walking: '↟',
};

export function CategoryIcon({ icon, className = '' }) {
  return (
    <span className={`category-icon ${className}`} aria-hidden="true">
      {ICON_SYMBOLS[icon] || '✦'}
    </span>
  );
}
