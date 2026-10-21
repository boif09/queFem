export const SERVICE_WORKER_URL = '/sw.js';

export function registerServiceWorker({ enabled = import.meta.env.PROD, target = globalThis } = {}) {
  const container = target.navigator?.serviceWorker;
  if (!enabled || !container) return false;
  const register = () => {
    container.register(SERVICE_WORKER_URL, { scope: '/' }).catch(() => {
      // Without a service worker the site keeps working exactly as before.
    });
  };
  if (target.document?.readyState === 'complete') register();
  else target.addEventListener?.('load', register, { once: true });
  return true;
}
