import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { localAgendaForMunicipality, localAgendasPath } from '../config/localAgendas.js';
import { trackLocalAgendaClick } from '../services/analytics.js';
import { uiLanguage } from '../utils/language.js';

// Shown with empty results for a municipality that has no recommended agenda of its own.
export function LocalAgendasEmptyHint({ municipality }) {
  const { t, i18n } = useTranslation();
  if (!municipality || localAgendaForMunicipality(municipality)) return null;
  return (
    <aside className="local-agendas-hint" aria-label={t('footer.localAgendas')}>
      <div>
        <p className="eyebrow dark">{t('footer.localAgendas')}</p>
        <h2>{t('localAgendas.emptyHintTitle')}</h2>
        <p>{t('localAgendas.emptyHint')}</p>
      </div>
      <Link to={localAgendasPath(uiLanguage(i18n))}>{t('home.localAgendasCta')} <span aria-hidden="true">→</span></Link>
    </aside>
  );
}

export function LocalAgendaRecommendation({ municipality }) {
  const { t, i18n } = useTranslation();
  const agenda = localAgendaForMunicipality(municipality);
  if (!agenda) return null;
  const language = uiLanguage(i18n);
  const title = t('localAgenda.title', { municipality: agenda.municipality });
  return (
    <aside className="local-agenda" aria-label={title}>
      <img className="local-agenda-logo" src={agenda.logo} alt="" width="64" height="64" loading="lazy" />
      <div className="local-agenda-text">
        <p className="eyebrow dark">{t('localAgenda.eyebrow')}</p>
        <h2>{title}</h2>
        <p>{t(`localAgenda.description.${agenda.id}`)}</p>
      </div>
      <div className="local-agenda-actions">
        <a
          className="local-agenda-cta"
          href={agenda.url}
          target="_blank"
          rel="noopener"
          onClick={() => trackLocalAgendaClick({ agenda: agenda.id, placement: 'results', language })}
        >
          {t('localAgenda.cta', { name: agenda.name })} <span aria-hidden="true">↗</span>
          <span className="sr-only"> {t('localAgenda.newTab')}</span>
        </a>
        <Link className="local-agenda-all" to={localAgendasPath(language)}>{t('localAgenda.all')}</Link>
      </div>
    </aside>
  );
}
