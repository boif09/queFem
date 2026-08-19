export function BrandMark({ className = '' }) {
  return <span className={`brand-stamp${className ? ` ${className}` : ''}`} aria-hidden="true">?</span>;
}

export function BrandLogo({ className = '', compact = false }) {
  return (
    <span className={`brand-wordmark${compact ? ' is-compact' : ''}${className ? ` ${className}` : ''}`} aria-label="Tens pla?">
      <BrandMark />
      {!compact && <strong aria-hidden="true">TENS PLA?</strong>}
    </span>
  );
}
