// Service worker de Tens pla?: només dona una pàgina sense connexió i guarda els assets
// amb hash de Vite. No guarda respostes de l'API, imatges de plans ni pàgines HTML, perquè
// els plans han de ser sempre els actuals.
const VERSION = 'v1';
const SHELL_CACHE = `tenspla-shell-${VERSION}`;
const ASSET_CACHE = `tenspla-assets-${VERSION}`;
const OFFLINE_URL = '/offline.html';
const SHELL_URLS = [OFFLINE_URL, '/offline.css', '/favicon.svg'];
const MAX_ASSET_ENTRIES = 80;
const BYPASS_PREFIXES = ['/api/', '/embed/', '/sitemap.xml'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL_CACHE, ASSET_CACHE]);
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith('tenspla-') && !keep.has(name)).map((name) => caches.delete(name)));
    if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
    await self.clients.claim();
  })());
});

function isBypassed(url) {
  return BYPASS_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
}

async function handleNavigation(event) {
  try {
    const preloaded = await event.preloadResponse;
    if (preloaded) return preloaded;
    return await fetch(event.request);
  } catch {
    const offline = await caches.match(OFFLINE_URL);
    return offline || Response.error();
  }
}

async function handleShellFile(request) {
  try {
    return await fetch(request);
  } catch {
    const cached = await caches.match(request, { ignoreSearch: true });
    return cached || Response.error();
  }
}

async function trimAssetCache(cache) {
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_ASSET_ENTRIES)).map((key) => cache.delete(key)));
}

async function handleAsset(event) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(event.request);
  if (cached) return cached;
  const response = await fetch(event.request);
  // The SPA fallback answers a missing old asset with index.html and status 200: never cache it.
  const isHtml = (response.headers.get('content-type') || '').includes('text/html');
  if (response.ok && response.type === 'basic' && !response.redirected && !isHtml) {
    const stored = cache.put(event.request, response.clone()).then(() => trimAssetCache(cache)).catch(() => {});
    try {
      event.waitUntil(stored);
    } catch {
      // Caching is best effort; the response is returned either way.
    }
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || request.headers.has('range')) return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || isBypassed(url)) return;

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(event));
    return;
  }
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(handleAsset(event));
    return;
  }
  if (SHELL_URLS.includes(url.pathname)) {
    event.respondWith(handleShellFile(request));
  }
});
