import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { trackPlanShare } from '../services/analytics.js';
import { uiLanguage } from '../utils/language.js';

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Native share sheet when the device has one; otherwise the link is copied to the clipboard.
export function ShareButton({ planId, title, url, target = globalThis }) {
  const { t, i18n } = useTranslation();
  const [status, setStatus] = useState('idle');
  const navigator = target.navigator;
  const canShare = typeof navigator?.share === 'function';
  const canCopy = typeof navigator?.clipboard?.writeText === 'function';

  useEffect(() => {
    if (status !== 'copied') return undefined;
    const timer = setTimeout(() => setStatus('idle'), 3000);
    return () => clearTimeout(timer);
  }, [status]);

  const onClick = async () => {
    const language = uiLanguage(i18n);
    setStatus('idle');
    if (canShare) {
      try {
        await navigator.share({ title, url });
        trackPlanShare({ planId, method: 'native', language });
        return;
      } catch (error) {
        if (error?.name === 'AbortError') return;
      }
    }
    if (!canCopy) { setStatus('failed'); return; }
    try {
      await navigator.clipboard.writeText(url);
      setStatus('copied');
      trackPlanShare({ planId, method: 'copy', language });
    } catch {
      setStatus('failed');
    }
  };

  return (
    <div className="share-control">
      <button type="button" className="share-button" onClick={onClick}>
        <ShareIcon />
        <span>{t('share.button')}</span>
      </button>
      <p className="share-status" role="status" aria-live="polite">
        {status === 'copied' && t('share.copied')}
        {status === 'failed' && t('share.failed')}
      </p>
      {status === 'failed' && (
        <input className="share-link" type="text" readOnly value={url} aria-label={t('share.linkLabel')} onFocus={(event) => event.target.select()} />
      )}
    </div>
  );
}
