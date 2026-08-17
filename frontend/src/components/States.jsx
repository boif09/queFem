import { useTranslation } from 'react-i18next';

export function LoadingState() {
  const { t } = useTranslation();
  return <div className="state-card" role="status"><span className="loader" aria-hidden="true" /><p>{t('state.loading')}</p></div>;
}

export function EmptyState({ titleKey = 'results.emptyTitle', textKey = 'results.emptyText' }) {
  const { t } = useTranslation();
  return <div className="state-card empty-state"><span aria-hidden="true">◇</span><h2>{t(titleKey)}</h2><p>{t(textKey)}</p></div>;
}

export function ErrorState({ titleKey = 'results.errorTitle', textKey = 'results.errorText', onRetry }) {
  const { t } = useTranslation();
  return (
    <div className="state-card error-state" role="alert">
      <span aria-hidden="true">!</span><h2>{t(titleKey)}</h2><p>{t(textKey)}</p>
      {onRetry && <button type="button" className="button button-secondary" onClick={onRetry}>{t('state.retry')}</button>}
    </div>
  );
}
