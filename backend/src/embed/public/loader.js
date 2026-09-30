/*! Tens pla? embed loader v1 — https://tenspla.cat */
(function () {
  'use strict';
  var KEY = /^wgt_[A-Za-z0-9]{16,40}$/;
  var script = document.currentScript;
  var base = script && script.src ? new URL(script.src).origin : 'https://tenspla.cat';
  var frames = [];

  function mount(element) {
    if (element.getAttribute('data-tenspla-mounted')) return;
    var key = element.getAttribute('data-tenspla-widget');
    if (!KEY.test(key || '')) return;
    element.setAttribute('data-tenspla-mounted', '1');
    var params = new URLSearchParams();
    var lang = element.getAttribute('data-lang');
    var theme = element.getAttribute('data-theme');
    if (lang === 'ca' || lang === 'es') params.set('lang', lang);
    if (theme === 'light' || theme === 'dark' || theme === 'auto') params.set('theme', theme);
    var query = params.toString();
    var iframe = document.createElement('iframe');
    iframe.src = base + '/embed/v1/w/' + key + (query ? '?' + query : '');
    iframe.title = element.getAttribute('data-title') || 'Agenda Tens pla?';
    iframe.loading = 'lazy';
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    iframe.setAttribute('scrolling', 'no');
    iframe.style.cssText = 'display:block;width:100%;border:0;height:480px;overflow:hidden;color-scheme:normal';
    element.appendChild(iframe);
    frames.push({ key: key, iframe: iframe });
  }

  window.addEventListener('message', function (event) {
    if (event.origin !== base || !event.data || event.data.type !== 'tenspla:resize') return;
    for (var i = 0; i < frames.length; i += 1) {
      if (frames[i].iframe.contentWindow === event.source) {
        var height = Number(event.data.height);
        if (height >= 80 && height <= 5000) frames[i].iframe.style.height = Math.ceil(height) + 'px';
      }
    }
  });

  function mountAll() {
    var nodes = document.querySelectorAll('[data-tenspla-widget]');
    for (var i = 0; i < nodes.length; i += 1) mount(nodes[i]);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountAll);
  else mountAll();
})();
