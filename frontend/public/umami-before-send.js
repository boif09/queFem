// Umami calls window.tensplaUmamiBeforeSend(type, payload) right before sending each page view or event
// (data-before-send in index.html). It removes the click identifiers that social networks and ad platforms
// append to links (fbclid, gclid, ttclid…): Tens pla? does not need them and they could link a visit to a person.
// Loaded as a separate same-origin file because the site CSP does not allow inline scripts. Plain ES5 string
// handling, so it works in old browsers and never throws: on any problem it returns the payload unchanged.
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

  root.tensplaUmamiBeforeSend = function (type, payload) {
    try {
      if (!payload || typeof payload !== 'object') return payload;
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
