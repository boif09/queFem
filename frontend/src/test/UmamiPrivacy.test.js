import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const frontendRoot = path.resolve(import.meta.dirname, '../..');

function loadBeforeSend(navigator) {
  const code = fs.readFileSync(path.join(frontendRoot, 'public/umami-before-send.js'), 'utf8');
  const fakeWindow = navigator === undefined ? {} : { navigator };
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

  describe('automated visits', () => {
    const REAL_CHROME = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
    const visit = (extra = {}) => ({ website: 'id', url: '/plans', screen: '1920x1080', language: 'en-US', ...extra });

    it('drops visits from browsers driven by automation, headless browsers, an 800x600 screen and server locales', () => {
      expect(loadBeforeSend({ webdriver: true, userAgent: REAL_CHROME })('event', visit())).toBeNull();
      expect(loadBeforeSend({ webdriver: false, userAgent: REAL_CHROME.replace('Chrome', 'HeadlessChrome') })('event', visit())).toBeNull();
      expect(loadBeforeSend({ webdriver: false, userAgent: REAL_CHROME })('event', visit({ screen: '800x600' }))).toBeNull();
      expect(loadBeforeSend({ webdriver: false, userAgent: REAL_CHROME })('event', visit({ language: 'en-US@posix' }))).toBeNull();
    });

    it('drops every kind of payload of an automated visit, not only page views', () => {
      const beforeSend = loadBeforeSend({ webdriver: true, userAgent: REAL_CHROME });
      for (const type of ['event', 'identify', 'performance']) expect(beforeSend(type, visit({ name: 'plan_view' }))).toBeNull();
    });

    it('keeps real visitors: Linux, US English, mobile, other languages and unusual but plausible screens', () => {
      const real = loadBeforeSend({ webdriver: false, userAgent: REAL_CHROME });
      const cases = [
        visit(), visit({ language: 'ca-ES', screen: '390x844' }), visit({ language: 'es-ES', screen: '1366x768' }),
        visit({ language: 'en-GB', screen: '412x915' }), visit({ language: 'zh-TW', screen: '1080x600' }), visit({ screen: '1024x768' }),
        visit({ screen: '800x1280' }), visit({ screen: '1280x800' }),
      ];
      for (const payload of cases) expect(real('event', payload)).toEqual(payload);
    });

    it('does not decide on the browser when it exposes no navigator, and a failing check never drops a visit', () => {
      expect(loadBeforeSend()('event', visit())).toEqual(visit());
      const hostile = { get webdriver() { throw new Error('boom'); } };
      expect(loadBeforeSend(hostile)('event', visit())).toEqual(visit());
      expect(loadBeforeSend({ webdriver: undefined, userAgent: undefined })('event', visit())).toEqual(visit());
    });

    it('still cleans click identifiers on a normal visit', () => {
      const real = loadBeforeSend({ webdriver: false, userAgent: REAL_CHROME });
      expect(real('event', visit({ url: '/plans?fbclid=1&utm_source=tiktok' })).url).toBe('/plans?utm_source=tiktok');
    });
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
