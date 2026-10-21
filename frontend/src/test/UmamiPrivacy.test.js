import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const frontendRoot = path.resolve(import.meta.dirname, '../..');

function loadBeforeSend() {
  const code = fs.readFileSync(path.join(frontendRoot, 'public/umami-before-send.js'), 'utf8');
  const fakeWindow = {};
  new Function('window', code)(fakeWindow);
  return fakeWindow.tensplaUmamiBeforeSend;
}

describe('Umami privacy settings', () => {
  it('loads the cleaning hook before Umami and asks Umami to respect Do Not Track', () => {
    const html = fs.readFileSync(path.join(frontendRoot, 'index.html'), 'utf8');
    const hook = html.indexOf('<script src="/umami-before-send.js"></script>');
    const umami = html.indexOf('https://stats.tenspla.cat/script.js');
    expect(hook).toBeGreaterThan(-1);
    expect(hook).toBeLessThan(umami);
    expect(html).toMatch(/stats\.tenspla\.cat\/script\.js"[^>]*data-do-not-track="true"/);
    expect(html).toMatch(/stats\.tenspla\.cat\/script\.js"[^>]*data-before-send="tensplaUmamiBeforeSend"/);
  });

  it('removes click identifiers from the page and referrer but keeps campaign parameters', () => {
    const beforeSend = loadBeforeSend();
    const payload = {
      website: 'id',
      url: '/cap-de-setmana?utm_source=instagram&utm_medium=social&fbclid=PAZXh0bgNhZW0&utm_campaign=2026w43',
      referrer: 'https://l.instagram.com/?u=https%3A%2F%2Ftenspla.cat&e=AT0&igshid=abc',
      title: 'Cap de setmana',
    };
    const clean = beforeSend('event', payload);
    expect(clean.url).toBe('/cap-de-setmana?utm_source=instagram&utm_medium=social&utm_campaign=2026w43');
    expect(clean.referrer).toBe('https://l.instagram.com/?u=https%3A%2F%2Ftenspla.cat&e=AT0');
    expect(clean.title).toBe('Cap de setmana');
    expect(payload.url).toContain('fbclid');
  });

  it('leaves addresses without click identifiers untouched and never drops the event', () => {
    const beforeSend = loadBeforeSend();
    expect(beforeSend('event', { url: '/plans/795', referrer: '' })).toEqual({ url: '/plans/795', referrer: '' });
    expect(beforeSend('event', { url: '/plans?gclid=1&TTCLID=2' }).url).toBe('/plans');
    expect(beforeSend('event', { name: 'plan_view', data: { plan_id: 1 } })).toEqual({ name: 'plan_view', data: { plan_id: 1 } });
  });

  it('keeps the host of absolute and protocol-relative addresses, encoded keys and the hash', () => {
    const beforeSend = loadBeforeSend();
    expect(beforeSend('event', { referrer: '//instagram.com/?fbclid=x&keep=1' }).referrer).toBe('//instagram.com/?keep=1');
    expect(beforeSend('event', { referrer: 'https://www.google.com/search?q=concerts&GCLID=1#top' }).referrer)
      .toBe('https://www.google.com/search?q=concerts#top');
    expect(beforeSend('event', { url: '/avui?%66bclid=1&utm_source=tiktok' }).url).toBe('/avui?utm_source=tiktok');
    expect(beforeSend('event', { url: '/avui?fbclid' }).url).toBe('/avui');
  });

  it('never throws or drops the event, even without modern browser features', () => {
    const code = fs.readFileSync(path.join(frontendRoot, 'public/umami-before-send.js'), 'utf8');
    const fakeWindow = {};
    const originalFrom = Array.from;
    const originalAssign = Object.assign;
    try {
      Array.from = undefined;
      Object.assign = undefined;
      new Function('window', code)(fakeWindow);
      expect(fakeWindow.tensplaUmamiBeforeSend('event', { url: '/plans?fbclid=1' })).toEqual({ url: '/plans' });
    } finally {
      Array.from = originalFrom;
      Object.assign = originalAssign;
    }
    const tricky = { get url() { throw new Error('boom'); } };
    expect(fakeWindow.tensplaUmamiBeforeSend('event', tricky)).toBe(tricky);
    expect(fakeWindow.tensplaUmamiBeforeSend('event', null)).toBeNull();
  });
});
