import { useEffect } from 'react';

export const PUBLIC_ORIGIN = 'https://tenspla.cat';
export const DEFAULT_SOCIAL_IMAGE = `${PUBLIC_ORIGIN}/og/tenspla-default.png`;

function upsertMeta(attribute, key, content) {
  let element = document.head.querySelector(`meta[${attribute}="${key}"]`);
  if (!element) {
    element = document.createElement('meta');
    element.setAttribute(attribute, key);
    document.head.append(element);
  }
  element.setAttribute('content', content);
}

function removeMeta(attribute, key) {
  document.head.querySelectorAll(`meta[${attribute}="${key}"]`).forEach((element) => element.remove());
}

export function Seo({
  title,
  description,
  canonicalPath = null,
  robots = 'index,follow',
  type = 'website',
  image = DEFAULT_SOCIAL_IMAGE,
  jsonLd = null,
}) {
  const canonical = canonicalPath === null ? null : new URL(canonicalPath, PUBLIC_ORIGIN).href;
  const serializedJsonLd = jsonLd ? JSON.stringify(jsonLd) : null;

  useEffect(() => {
    document.title = title;
    upsertMeta('name', 'description', description);
    upsertMeta('name', 'robots', robots);
    upsertMeta('property', 'og:site_name', 'Tens pla?');
    upsertMeta('property', 'og:type', type);
    upsertMeta('property', 'og:title', title);
    upsertMeta('property', 'og:description', description);
    upsertMeta('name', 'twitter:card', image ? 'summary_large_image' : 'summary');
    upsertMeta('name', 'twitter:title', title);
    upsertMeta('name', 'twitter:description', description);

    let canonicalElement = document.head.querySelector('link[rel="canonical"]');
    if (canonical) {
      if (!canonicalElement) {
        canonicalElement = document.createElement('link');
        canonicalElement.setAttribute('rel', 'canonical');
        document.head.append(canonicalElement);
      }
      canonicalElement.setAttribute('href', canonical);
      upsertMeta('property', 'og:url', canonical);
    } else {
      canonicalElement?.remove();
      removeMeta('property', 'og:url');
    }

    if (image) {
      upsertMeta('property', 'og:image', image);
      upsertMeta('name', 'twitter:image', image);
    } else {
      removeMeta('property', 'og:image');
      removeMeta('name', 'twitter:image');
    }

    let script = document.head.querySelector('script[data-tenspla-jsonld]');
    if (serializedJsonLd) {
      if (!script) {
        script = document.createElement('script');
        script.type = 'application/ld+json';
        script.dataset.tensplaJsonld = '';
        document.head.append(script);
      }
      script.textContent = serializedJsonLd;
    } else {
      script?.remove();
    }
  }, [canonical, description, image, robots, serializedJsonLd, title, type]);

  return null;
}
