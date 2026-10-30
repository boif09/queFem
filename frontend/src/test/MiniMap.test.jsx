import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import i18n from '../i18n.js';
import { hasValidCoordinates, mapUrls, MiniMap } from '../components/MiniMap.jsx';

describe('MiniMap', () => {
  it('builds keyless OpenStreetMap and Google Maps URLs for valid coordinates', () => {
    const urls = mapUrls(41.95, 3.2);

    expect(urls.embed).toContain('openstreetmap.org/export/embed.html');
    expect(urls.embed).toContain('marker=41.95%2C3.2');
    expect(urls.google).toBe('https://www.google.com/maps/search/?api=1&query=41.95%2C3.2');
  });

  it('rejects missing and out-of-range coordinates', () => {
    expect(hasValidCoordinates(null, 3.2)).toBe(false);
    expect(hasValidCoordinates(91, 3.2)).toBe(false);
    expect(hasValidCoordinates(41.95, 181)).toBe(false);
    expect(mapUrls(undefined, undefined)).toBeNull();
  });

  it('shows the OpenStreetMap map straight away, loaded lazily and with attribution', async () => {
    await i18n.changeLanguage('ca');
    render(<MiniMap latitude={41.95} longitude={3.2} />);

    const map = screen.getByTitle('Mapa de la ubicació');
    expect(map).toHaveAttribute('src', expect.stringContaining('openstreetmap.org/export/embed.html'));
    expect(map).toHaveAttribute('loading', 'lazy');
    expect(screen.getByText('© OpenStreetMap contributors')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
