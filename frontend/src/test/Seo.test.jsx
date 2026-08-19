import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Seo } from '../components/Seo.jsx';
import { NotFoundPage } from '../pages/NotFoundPage.jsx';

describe('central SEO metadata', () => {
  it('updates route metadata without duplicating managed tags', async () => {
    const { rerender } = render(<Seo title="Primera | Tens pla?" description="Primera" canonicalPath="/" />);
    await waitFor(() => expect(document.title).toBe('Primera | Tens pla?'));
    rerender(<Seo title="Segona | Tens pla?" description="Segona" canonicalPath="/fonts" />);
    await waitFor(() => expect(document.title).toBe('Segona | Tens pla?'));

    expect(document.head.querySelectorAll('meta[name="description"]')).toHaveLength(1);
    expect(document.head.querySelectorAll('meta[property="og:title"]')).toHaveLength(1);
    expect(document.head.querySelectorAll('meta[name="twitter:title"]')).toHaveLength(1);
    expect(document.head.querySelectorAll('link[rel="canonical"]')).toHaveLength(1);
    expect(document.head.querySelector('link[rel="canonical"]')).toHaveAttribute('href', 'https://tenspla.cat/fonts');
  });

  it('marks NotFound noindex and removes canonical metadata', async () => {
    render(<MemoryRouter><NotFoundPage /></MemoryRouter>);
    await waitFor(() => expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute('content', 'noindex,follow'));
    expect(document.head.querySelector('link[rel="canonical"]')).not.toBeInTheDocument();
  });

  it('ships a local favicon, social PNG and permissive robots file', () => {
    const frontendRoot = path.resolve(import.meta.dirname, '../..');
    const index = fs.readFileSync(path.join(frontendRoot, 'index.html'), 'utf8');
    const robots = fs.readFileSync(path.join(frontendRoot, 'public/robots.txt'), 'utf8');
    const favicon = path.join(frontendRoot, 'public/favicon.svg');
    const socialImage = path.join(frontendRoot, 'public/og/tenspla-default.png');
    const png = fs.readFileSync(socialImage);

    expect(index).toContain('rel="icon" href="/favicon.svg"');
    expect(index).toContain('property="og:site_name" content="Tens pla?"');
    expect(index).toContain('property="og:url" content="https://tenspla.cat/"');
    expect(index).toContain('property="og:image" content="https://tenspla.cat/og/tenspla-default.png"');
    expect(index).toContain('name="twitter:card" content="summary_large_image"');
    expect(index).toContain('name="twitter:image" content="https://tenspla.cat/og/tenspla-default.png"');
    expect(fs.existsSync(favicon)).toBe(true);
    expect(fs.statSync(socialImage).size).toBeGreaterThan(0);
    expect(png.toString('ascii', 1, 4)).toBe('PNG');
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(630);
    expect(robots).toContain('User-agent: *');
    expect(robots).toContain('Allow: /');
    expect(robots).toContain('Sitemap: https://tenspla.cat/sitemap.xml');
    expect(robots).not.toContain('Disallow: /plans');
  });
});
