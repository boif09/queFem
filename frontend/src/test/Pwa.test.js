import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { registerServiceWorker, SERVICE_WORKER_URL } from '../services/serviceWorker.js';

const publicDir = `${path.resolve(import.meta.dirname, '../../public')}/`;

function fakeTarget({ readyState = 'complete', register = vi.fn(() => Promise.resolve()) } = {}) {
  const listeners = {};
  return {
    navigator: { serviceWorker: { register } },
    document: { readyState },
    addEventListener: (type, listener) => { listeners[type] = listener; },
    listeners,
    register,
  };
}

describe('service worker registration', () => {
  it('registers the root-scoped worker only when enabled', () => {
    const target = fakeTarget();
    expect(registerServiceWorker({ enabled: true, target })).toBe(true);
    expect(target.register).toHaveBeenCalledWith(SERVICE_WORKER_URL, { scope: '/' });

    const disabled = fakeTarget();
    expect(registerServiceWorker({ enabled: false, target: disabled })).toBe(false);
    expect(disabled.register).not.toHaveBeenCalled();
  });

  it('waits for the load event and tolerates browsers without service workers or failed registrations', async () => {
    const target = fakeTarget({ readyState: 'loading', register: vi.fn(() => Promise.reject(new Error('blocked'))) });
    registerServiceWorker({ enabled: true, target });
    expect(target.register).not.toHaveBeenCalled();
    target.listeners.load();
    expect(target.register).toHaveBeenCalledTimes(1);
    await Promise.resolve();

    expect(registerServiceWorker({ enabled: true, target: { navigator: {} } })).toBe(false);
  });
});

describe('PWA assets', () => {
  it('ships an installable manifest whose icons exist', () => {
    const manifest = JSON.parse(fs.readFileSync(`${publicDir}manifest.webmanifest`, 'utf8'));
    expect(manifest).toMatchObject({ start_url: '/', scope: '/', display: 'standalone', lang: 'ca' });
    const sizes = manifest.icons.map((icon) => `${icon.sizes}:${icon.purpose}`);
    expect(sizes).toEqual(expect.arrayContaining(['192x192:any', '512x512:any', '512x512:maskable']));
    for (const icon of manifest.icons) expect(fs.existsSync(`${publicDir}${icon.src.slice(1)}`)).toBe(true);
  });

  it('keeps the API, the embed widget and the sitemap out of the service worker', () => {
    const worker = fs.readFileSync(`${publicDir}sw.js`, 'utf8');
    expect(worker).toMatch(/BYPASS_PREFIXES = \['\/api\/', '\/embed\/', '\/sitemap\.xml'\]/);
    for (const url of ['/offline.html', '/offline.css', '/favicon.svg']) expect(fs.existsSync(`${publicDir}${url.slice(1)}`)).toBe(true);
  });
});
