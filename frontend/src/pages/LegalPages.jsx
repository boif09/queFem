import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Seo } from '../components/Seo.jsx';

const CONTACT_EMAIL = 'contacte@tenspla.cat';

function LegalPage({ pageKey, children }) {
  const { t } = useTranslation();
  const title = t(`legal.${pageKey}.title`);
  return (
    <><Seo title={`${title} | ${t('app.name')}`} description={t(`legal.${pageKey}.intro`)} robots="noindex,follow" />
    <section className="page-section legal-page">
      <article className="container legal-container">
        <header className="page-heading legal-heading">
          <p className="eyebrow dark">{t('legal.common.eyebrow')}</p>
          <h1>{title}</h1>
          <p>{t(`legal.${pageKey}.intro`)}</p>
          <p className="legal-updated">{t('legal.common.updated')}</p>
        </header>
        <div className="legal-document">{children}</div>
      </article>
    </section></>
  );
}

function Section({ title, children }) {
  return <section className="legal-section"><h2>{title}</h2>{children}</section>;
}

function EmailLink() {
  const { t } = useTranslation();
  return <a href={`mailto:${CONTACT_EMAIL}`}>{t('legal.common.emailLabel')}</a>;
}

export function LegalNoticePage() {
  const { t, i18n } = useTranslation();
  const contactPath = i18n.resolvedLanguage?.startsWith('es') ? '/contacto' : '/contacte';
  return (
    <LegalPage pageKey="notice">
      <Section title={t('legal.notice.identityTitle')}><p>{t('legal.notice.identityBody')}</p><p><EmailLink /></p></Section>
      <Section title={t('legal.notice.natureTitle')}><p>{t('legal.notice.natureBody')}</p><p>{t('legal.notice.ticketsBody')}</p></Section>
      <Section title={t('legal.notice.informationTitle')}><p>{t('legal.notice.informationBody')}</p><p>{t('legal.notice.rightsBody')}</p></Section>
      <Section title={t('legal.notice.useTitle')}>
        <p>{t('legal.notice.useBody')}</p>
        <p className="legal-inline-links"><Link to="/fonts">{t('legal.notice.sourcesLink')}</Link><Link to={contactPath}>{t('legal.notice.contactLink')}</Link></p>
      </Section>
    </LegalPage>
  );
}

export function PrivacyPage() {
  const { t } = useTranslation();
  return (
    <LegalPage pageKey="privacy">
      <Section title={t('legal.privacy.controllerTitle')}><p>{t('legal.privacy.controllerBody')}</p><p><EmailLink /></p></Section>
      <Section title={t('legal.privacy.dataTitle')}>
        <h3>{t('legal.privacy.logsTitle')}</h3><p>{t('legal.privacy.logsBody')}</p>
        <h3>{t('legal.privacy.emailTitle')}</h3><p>{t('legal.privacy.emailBody')}</p>
        <h3>{t('legal.privacy.languageTitle')}</h3><p>{t('legal.privacy.languageBody')}</p>
      </Section>
      <Section title={t('legal.privacy.dataNatureTitle')}><p>{t('legal.privacy.dataNatureBody')}</p></Section>
      <Section title={t('legal.privacy.purposesTitle')}><p>{t('legal.privacy.purposesBody')}</p></Section>
      <Section title={t('legal.privacy.basisTitle')}><p>{t('legal.privacy.basisBody')}</p></Section>
      <Section title={t('legal.privacy.retentionTitle')}><ul><li>{t('legal.privacy.retentionLogs')}</li><li>{t('legal.privacy.retentionLanguage')}</li><li>{t('legal.privacy.retentionEmail')}</li></ul></Section>
      <Section title={t('legal.privacy.providersTitle')}><h3>Hetzner Online GmbH</h3><p>{t('legal.privacy.hetznerBody')}</p><h3>OVHcloud</h3><p>{t('legal.privacy.ovhBody')}</p><p>{t('legal.privacy.sharingBody')}</p></Section>
      <Section title={t('legal.privacy.externalTitle')}><ul><li>{t('legal.privacy.osmBody')}</li><li>{t('legal.privacy.mapsBody')}</li><li>{t('legal.privacy.ticketmasterBody')}</li><li>{t('legal.privacy.sourcesBody')}</li></ul><p>{t('legal.common.externalPolicies')}</p></Section>
      <Section title={t('legal.privacy.rightsTitle')}><p>{t('legal.privacy.rightsBody')}</p><p><EmailLink /></p><p><a href="https://www.aepd.es" target="_blank" rel="noreferrer">{t('legal.privacy.aepdLink')} <span aria-hidden="true">↗</span></a></p></Section>
      <Section title={t('legal.privacy.automationTitle')}><p>{t('legal.privacy.automationBody')}</p></Section>
    </LegalPage>
  );
}

export function StoragePage() {
  const { t } = useTranslation();
  return (
    <LegalPage pageKey="storage">
      <Section title={t('legal.storage.cookiesTitle')}><p>{t('legal.storage.cookiesBody')}</p></Section>
      <Section title={t('legal.storage.languageTitle')}><p>{t('legal.storage.languageBody')}</p><p>{t('legal.storage.sharingBody')}</p></Section>
      <Section title={t('legal.storage.deleteTitle')}><p>{t('legal.storage.deleteBody')}</p></Section>
      <Section title={t('legal.storage.mapTitle')}><p>{t('legal.storage.mapBody')}</p></Section>
    </LegalPage>
  );
}

export function ContactPage() {
  const { t } = useTranslation();
  return (
    <LegalPage pageKey="contact">
      <Section title={t('legal.contact.channelTitle')}><p>{t('legal.contact.channelBody')}</p><p className="contact-email"><EmailLink /></p></Section>
      <Section title={t('legal.contact.requestsTitle')}><p>{t('legal.contact.requestsBody')}</p><p>{t('legal.contact.ticketmasterBody')}</p></Section>
      <Section title={t('legal.contact.minimumTitle')}><p>{t('legal.contact.minimumBody')}</p></Section>
    </LegalPage>
  );
}
