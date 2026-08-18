import logoUrl from '../assets/quefem-logo.png';

export function BrandLogo({ className = '' }) {
  return (
    <img
      className={`brand-logo${className ? ` ${className}` : ''}`}
      src={logoUrl}
      width="512"
      height="157"
      alt="Què Fem?"
    />
  );
}
