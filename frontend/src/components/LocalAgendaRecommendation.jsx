import { useTranslation } from 'react-i18next';
import { localAgendaForMunicipality } from '../config/localAgendas.js';
import { trackLocalAgendaClick } from '../services/analytics.js';
import { uiLanguage } from '../utils/language.js';

export function LocalAgendaRecommendation({ municipality }) {
  const { t, i18n } = useTranslation();
  const agenda = localAgendaForMunicipality(municipality);
  if (!agenda) return null;
  const title = t('localAgenda.title', { municipality: agenda.municipality });
  return (
    <aside className="local-agenda" aria-label={title}>
      <img className="local-agenda-logo" src={agenda.logo} alt="" width="64" height="64" loading="lazy" />
      <div className="local-agenda-text">
        <p className="eyebrow dark">{t('localAgenda.eyebrow')}</p>
        <h2>{title}</h2>
        <p>{t(`localAgenda.description.${agenda.id}`)}</p>
      </div>
      <a
        className="local-agenda-cta"
        href={agenda.url}
        target="_blank"
        rel="noopener"
        onClick={() => trackLocalAgendaClick({ agenda: agenda.id, language: uiLanguage(i18n) })}
      >
        {t('localAgenda.cta', { name: agenda.name })} <span aria-hidden="true">↗</span>
        <span className="sr-only"> {t('localAgenda.newTab')}</span>
      </a>
    </aside>
  );
}
