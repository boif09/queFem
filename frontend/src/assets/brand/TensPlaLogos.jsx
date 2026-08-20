const FONT_FAMILY = '"Montserrat Variable", Montserrat, sans-serif';

export function TensPlaHorizontalLogo({ className = '' }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 460 120"
      role="img"
      aria-label="Tens pla?"
    >
      <text x="0" y="90" fontFamily={FONT_FAMILY} fontWeight="900" fontSize="80" fill="#1A1A1A">Tens pla</text>
      <text x="380" y="100" fontFamily={FONT_FAMILY} fontWeight="900" fontSize="110" fill="#FF4D3D" transform="rotate(10 415 65)">?</text>
    </svg>
  );
}

export function TensPlaStackedLogo({ className = '' }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 320 220"
      role="img"
      aria-label="Tens pla?"
    >
      <text x="0" y="80" fontFamily={FONT_FAMILY} fontWeight="900" fontSize="85" fill="#1A1A1A">Tens</text>
      <text x="0" y="175" fontFamily={FONT_FAMILY} fontWeight="900" fontSize="85" fill="#1A1A1A">pla</text>
      <text x="180" y="180" fontFamily={FONT_FAMILY} fontWeight="900" fontSize="140" fill="#FF4D3D" transform="rotate(5 230 130)">?</text>
    </svg>
  );
}
