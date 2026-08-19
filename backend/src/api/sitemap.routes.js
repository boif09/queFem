import { Router } from 'express';

const PUBLIC_ORIGIN = 'https://tenspla.cat';

export function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export function buildSitemapXml(urls) {
  const entries = urls.map((url) => `  <url><loc>${escapeXml(url)}</loc></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`;
}

export function createSitemapRouter(repository) {
  const router = Router();
  router.get('/', (request, response) => {
    const urls = [
      `${PUBLIC_ORIGIN}/`,
      `${PUBLIC_ORIGIN}/plans`,
      `${PUBLIC_ORIGIN}/fonts`,
      ...repository.findSitemapPlanIds().map((id) => `${PUBLIC_ORIGIN}/plans/${id}`),
    ];
    response.type('application/xml').send(buildSitemapXml(urls));
  });
  return router;
}
