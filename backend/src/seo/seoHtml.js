import { PUBLIC_ORIGIN } from '../../../shared/seo/eventJsonLd.js';

export const DEFAULT_SOCIAL_IMAGE = `${PUBLIC_ORIGIN}/og/tenspla-default.png`;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function escapeJsonForHtml(value) {
  return JSON.stringify(value).replace(/[<>&]/g, (character) => ({
    '<': '\\u003c', '>': '\\u003e', '&': '\\u0026',
  })[character]);
}

function replaceMeta(html, attribute, key, content) {
  const expression = new RegExp(`<meta\\s+${attribute}=["']${key}["'][^>]*>`, 'i');
  const tag = `<meta ${attribute}="${key}" content="${escapeHtml(content)}" />`;
  return expression.test(html) ? html.replace(expression, tag) : html.replace('</head>', `  ${tag}\n</head>`);
}

export function renderSeoHtml(template, { title, description, robots, canonicalPath = null, jsonLd = null }) {
  let html = template.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(title)}</title>`);
  html = replaceMeta(html, 'name', 'description', description);
  html = replaceMeta(html, 'name', 'robots', robots);
  html = replaceMeta(html, 'property', 'og:site_name', 'Tens pla?');
  html = replaceMeta(html, 'property', 'og:type', 'website');
  html = replaceMeta(html, 'property', 'og:title', title);
  html = replaceMeta(html, 'property', 'og:description', description);
  html = replaceMeta(html, 'property', 'og:image', DEFAULT_SOCIAL_IMAGE);
  html = replaceMeta(html, 'name', 'twitter:card', 'summary_large_image');
  html = replaceMeta(html, 'name', 'twitter:title', title);
  html = replaceMeta(html, 'name', 'twitter:description', description);
  html = replaceMeta(html, 'name', 'twitter:image', DEFAULT_SOCIAL_IMAGE);
  html = html.replace(/<meta\s+property=["']og:url["'][^>]*>\s*/gi, '');
  html = html.replace(/<link\s+rel=["']canonical["'][^>]*>\s*/gi, '');
  html = html.replace(/<script\s+data-tenspla-jsonld[^>]*>[\s\S]*?<\/script>\s*/gi, '');
  const canonical = canonicalPath ? new URL(canonicalPath, PUBLIC_ORIGIN).href : null;
  const additions = [
    canonical && `<link rel="canonical" href="${escapeHtml(canonical)}" />`,
    canonical && `<meta property="og:url" content="${escapeHtml(canonical)}" />`,
    jsonLd && `<script type="application/ld+json" data-tenspla-jsonld>${escapeJsonForHtml(jsonLd)}</script>`,
  ].filter(Boolean).join('\n    ');
  return additions ? html.replace('</head>', `    ${additions}\n  </head>`) : html;
}
