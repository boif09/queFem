import { useTranslation } from 'react-i18next';
import { Seo } from '../components/Seo.jsx';
import { LOCAL_AGENDAS } from '../config/localAgendas.js';
import { trackLocalAgendaClick } from '../services/analytics.js';
import { uiLanguage } from '../utils/language.js';

const CONTACT_EMAIL = 'contacte@tenspla.cat';
const CRITERIA = ['independent', 'noAds', 'linkOnly', 'permission'];

export function LocalAgendasPage() {
  const { t, i18n } = useTranslation();
  const language = uiLanguage(i18n);
  const mailto = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(t('localAgendas.mailSubject'))}`;

  return (
    <><Seo title={t('seo.localAgendasTitle')} description={t('seo.localAgendasDescription')} canonicalPath="/agendes-locals" />
    <section className="page-section local-agendas-page">
      <div className="container">
        <header className="page-heading local-agendas-heading">
          <p className="eyebrow dark">{t('localAgendas.eyebrow')}</p>
          <h1>{t('localAgendas.title')}</h1>
          <p>{t('localAgendas.intro')}</p>
        </header>

        <section className="local-agendas-section" aria-labelledby="local-agendas-list-title">
          <h2 id="local-agendas-list-title">{t('localAgendas.listTitle')}</h2>
          <p className="local-agendas-note">{t('localAgendas.listNote')}</p>
          <ul className="local-agendas-list">
            {LOCAL_AGENDAS.map((agenda) => (
              <li key={agenda.id} className="local-agenda-card">
                <img
                  className="local-agenda-card-logo"
                  src={agenda.wideLogo.src}
                  width={agenda.wideLogo.width}
                  height={agenda.wideLogo.height}
                  alt=""
                  loading="lazy"
                />
                <p className="local-agenda-card-place">{agenda.municipality}</p>
                <h3>{agenda.name}</h3>
                <p>{t(`localAgenda.description.${agenda.id}`)}</p>
                <a
                  className="local-agenda-cta"
                  href={agenda.url}
                  target="_blank"
                  rel="noopener"
                  onClick={() => trackLocalAgendaClick({ agenda: agenda.id, placement: 'directory', language })}
                >
                  {t('localAgenda.cta', { name: agenda.name })} <span aria-hidden="true">↗</span>
                  <span className="sr-only"> {t('localAgenda.newTab')}</span>
                </a>
              </li>
            ))}
            <li className="local-agenda-card is-placeholder">
              <h3>{t('localAgendas.placeholderTitle')}</h3>
              <p>{t('localAgendas.placeholderBody')}</p>
              <a href={mailto}>{t('localAgendas.placeholderLink')}</a>
            </li>
          </ul>
        </section>

        <section className="local-agendas-section" aria-labelledby="local-agendas-criteria-title">
          <h2 id="local-agendas-criteria-title">{t('localAgendas.criteriaTitle')}</h2>
          <ul className="local-agendas-criteria">
            {CRITERIA.map((criterion) => <li key={criterion}>{t(`localAgendas.criteria.${criterion}`)}</li>)}
          </ul>
        </section>

        <section className="local-agendas-contact" aria-labelledby="local-agendas-contact-title">
          <h2 id="local-agendas-contact-title">{t('localAgendas.contactTitle')}</h2>
          <p>{t('localAgendas.contactBody')}</p>
          <a className="local-agenda-cta" href={mailto}>{CONTACT_EMAIL}</a>
        </section>
      </div>
    </section></>
  );
}
