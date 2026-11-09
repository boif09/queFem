// Umami calls window.tensplaUmamiBeforeSend(type, payload) right before sending each page view or event
// (data-before-send in index.html). It removes the click identifiers that social networks and ad platforms
// append to links (fbclid, gclid, ttclid…): Tens pla? does not need them and they could link a visit to a person.
// It also drops the visits of obvious automation (see isAutomated) so the statistics describe people: Umami cancels
// the send when this function returns a falsy value. Loaded as a separate same-origin file because the site CSP does
// not allow inline scripts. Plain ES5 string handling, so it works in old browsers and never throws: on any problem
// it returns the payload unchanged and the event is sent as usual.
(function (root) {
  'use strict';
  var CLICK_IDS = ['fbclid', 'gclid', 'gbraid', 'wbraid', 'dclid', 'msclkid', 'ttclid', 'twclid', 'li_fat_id',
    'igshid', 'igsh', 'yclid', 'mc_eid', 'epik', 'rdt_cid', 'sccid', '_gl'];

  function isClickId(pair) {
    var key = pair.split('=')[0];
    try { key = decodeURIComponent(key.replace(/\+/g, ' ')); } catch (error) { /* Keep the raw key. */ }
    return CLICK_IDS.indexOf(key.toLowerCase()) !== -1;
  }

  // Only the query string is touched; scheme, host, path and hash are kept exactly as they were.
  function stripClickIds(value) {
    if (typeof value !== 'string') return value;
    var hashAt = value.indexOf('#');
    var hash = hashAt === -1 ? '' : value.slice(hashAt);
    var beforeHash = hashAt === -1 ? value : value.slice(0, hashAt);
    var queryAt = beforeHash.indexOf('?');
    if (queryAt === -1) return value;
    var pairs = beforeHash.slice(queryAt + 1).split('&');
    var kept = [];
    for (var i = 0; i < pairs.length; i += 1) {
      if (pairs[i] && !isClickId(pairs[i])) kept.push(pairs[i]);
    }
    if (kept.length === pairs.length) return value;
    return beforeHash.slice(0, queryAt) + (kept.length ? '?' + kept.join('&') : '') + hash;
  }

  // Signals that a real person's browser essentially never produces, so a false positive is practically impossible:
  //  - navigator.webdriver: set by the browser itself when it is driven by Puppeteer, Playwright, Selenium...
  //  - "Headless" in the user agent (HeadlessChrome).
  //  - an 800x600 screen: the default window of headless browsers (it was 30 of the 178 US sessions measured).
  //  - a language containing "@" (e.g. en-US@posix): a server locale, not a browser setting.
  // Deliberately NOT used: country, operating system or "en-US" on its own, because real tourists and Linux users exist
  // (the site has an English interface). Bots that pretend to be ordinary browsers are not caught; that is accepted.
  function isAutomated(payload) {
    try {
      var nav = root.navigator;
      if (nav && nav.webdriver === true) return true;
      if (nav && typeof nav.userAgent === 'string' && /headless/i.test(nav.userAgent)) return true;
      if (payload.screen === '800x600') return true;
      if (typeof payload.language === 'string' && payload.language.indexOf('@') !== -1) return true;
    } catch (error) { /* A failed check never blocks a visit. */ }
    return false;
  }

  root.tensplaUmamiBeforeSend = function (type, payload) {
    try {
      if (!payload || typeof payload !== 'object') return payload;
      if (isAutomated(payload)) return null;
      var clean = {};
      for (var key in payload) {
        if (Object.prototype.hasOwnProperty.call(payload, key)) clean[key] = payload[key];
      }
      if ('url' in clean) clean.url = stripClickIds(clean.url);
      if ('referrer' in clean) clean.referrer = stripClickIds(clean.referrer);
      return clean;
    } catch (error) {
      return payload;
    }
  };
}(window));
