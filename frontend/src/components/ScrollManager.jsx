import { useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

// The SPA swaps content without reloading, so the browser keeps the old scroll position on every route change.
// Rules: going to another page or to another results page starts at the top; changing filters on the same page keeps
// the position; Back/Forward returns to where that entry was left, waiting for its plans to render.
const RESTORE_TIMEOUT_MS = 3000;
const RESTORE_INTERVAL_MS = 100;

function scrollToY(y) {
  // `instant` overrides the site's `scroll-behavior: smooth`, which would otherwise animate every page change.
  window.scrollTo({ top: y, left: 0, behavior: 'instant' });
}

export function shouldScrollToTop(previous, next) {
  if (!previous) return false;
  if (previous.pathname !== next.pathname) return true;
  const page = (location) => new URLSearchParams(location.search).get('page') || '1';
  return page(previous) !== page(next);
}

export function ScrollManager() {
  const location = useLocation();
  const navigationType = useNavigationType();
  const positions = useRef(new Map());
  const currentKey = useRef(location.key);
  const previousLocation = useRef(null);

  useEffect(() => {
    if (!('scrollRestoration' in window.history)) return undefined;
    const original = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    return () => { window.history.scrollRestoration = original; };
  }, []);

  useEffect(() => {
    let frame = 0;
    const save = () => {
      frame = 0;
      positions.current.set(currentKey.current, window.scrollY);
    };
    const onScroll = () => { if (!frame) frame = window.requestAnimationFrame(save); };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  useLayoutEffect(() => {
    const previous = previousLocation.current;
    previousLocation.current = location;
    currentKey.current = location.key;
    if (!previous || location.hash) return undefined;

    if (navigationType !== 'POP') {
      if (shouldScrollToTop(previous, location)) scrollToY(0);
      return undefined;
    }

    const target = positions.current.get(location.key) || 0;
    scrollToY(target);
    if (target === 0) return undefined;

    // The plans of the page we return to load asynchronously: retry until the page is tall enough, or stop as soon as
    // the user scrolls by hand.
    let cancelled = false;
    const cancel = () => { cancelled = true; };
    const events = ['wheel', 'touchstart', 'keydown', 'mousedown'];
    events.forEach((name) => window.addEventListener(name, cancel, { passive: true, once: true }));
    const started = Date.now();
    const timer = window.setInterval(() => {
      const reachable = document.documentElement.scrollHeight - window.innerHeight >= target;
      if (cancelled || Date.now() - started > RESTORE_TIMEOUT_MS) { window.clearInterval(timer); return; }
      if (Math.abs(window.scrollY - target) > 2) scrollToY(target);
      if (reachable && Math.abs(window.scrollY - target) <= 2) window.clearInterval(timer);
    }, RESTORE_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
      events.forEach((name) => window.removeEventListener(name, cancel));
    };
  }, [location, navigationType]);

  return null;
}
