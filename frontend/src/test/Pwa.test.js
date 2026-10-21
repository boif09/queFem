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

  it('links the Android app to the site with the Play App Signing fingerprint', () => {
    const links = JSON.parse(fs.readFileSync(`${publicDir}.well-known/assetlinks.json`, 'utf8'));
    expect(links).toHaveLength(1);
    expect(links[0].relation).toEqual(['delegate_permission/common.handle_all_urls']);
    expect(links[0].target).toMatchObject({ namespace: 'android_app', package_name: 'cat.tenspla.app' });
    for (const fingerprint of links[0].target.sha256_cert_fingerprints) {
      expect(fingerprint).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    }
  });

  it('keeps the API, the embed widget and the sitemap out of the service worker', () => {
    const worker = fs.readFileSync(`${publicDir}sw.js`, 'utf8');
    expect(worker).toMatch(/BYPASS_PREFIXES = \['\/api\/', '\/embed\/', '\/sitemap\.xml'\]/);
    for (const url of ['/offline.html', '/offline.css', '/favicon.svg']) expect(fs.existsSync(`${publicDir}${url.slice(1)}`)).toBe(true);
  });
});
