import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Seo } from '../components/Seo.jsx';

const CONTACT_EMAIL = 'contacte@tenspla.cat';

// Public demo widgets, created in each environment with `npm run embed:widgets -- create --key ...`
// and allowed only on tenspla.cat (see docs/EMBED_WIDGET.md).
export const WIDGET_DEMOS = [
  { id: 'comarca', key: 'wgt_TensPlaDemoBages2026' },
  { id: 'stay', key: 'wgt_TensPlaDemoEmporda2026' },
];

const SNIPPET = `<div data-tenspla-widget="wgt_LA_TEVA_CLAU"></div>
<script src="https://tenspla.cat/embed/v1/loader.js" async></script>`;

function DemoFrame({ demo, language, title }) {
  const frame = useRef(null);
  const [height, setHeight] = useState(640);
  useEffect(() => {
    function onMessage(event) {
      if (event.origin !== window.location.origin || event.source !== frame.current?.contentWindow) return;
      if (event.data?.type !== 'tenspla:resize') return;
      const next = Number(event.data.height);
      if (next >= 80 && next <= 5000) setHeight(Math.ceil(next));
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);
  return (
    <iframe
      ref={frame}
      className="widget-demo-frame"
      src={`/embed/v1/w/${demo.key}?lang=${language}`}
      title={title}
      loading="lazy"
      style={{ height }}
    />
  );
}

export function WidgetPage() {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage?.startsWith('es') ? 'es' : 'ca';
  const [demoId, setDemoId] = useState(WIDGET_DEMOS[0].id);
  const demo = WIDGET_DEMOS.find(({ id }) => id === demoId);
  const mailto = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(t('widget.mailSubject'))}`;
  const steps = ['write', 'setup', 'paste'];
  const features = ['sources', 'territory', 'look', 'languages', 'fresh', 'privacy', 'domains'];

  return (
    <><Seo title={t('seo.widgetTitle')} description={t('seo.widgetDescription')} canonicalPath="/widget" />
    <section className="page-section widget-page">
      <div className="container">
        <header className="page-heading widget-heading">
          <p className="eyebrow dark">{t('widget.eyebrow')}</p>
          <h1>{t('widget.title')}</h1>
          <p>{t('widget.intro')}</p>
          <a className="widget-cta-button" href={mailto}>{t('widget.ctaButton')}</a>
        </header>

        <section className="widget-demo" aria-labelledby="widget-demo-title">
          <div className="widget-demo-intro">
            <h2 id="widget-demo-title">{t('widget.demoTitle')}</h2>
            <p>{t('widget.demoIntro')}</p>
            <div className="widget-demo-switch" role="group" aria-label={t('widget.demoSwitchLabel')}>
              {WIDGET_DEMOS.map(({ id }) => (
                <button key={id} type="button" aria-pressed={id === demoId} onClick={() => setDemoId(id)}>
                  {t(`widget.demo.${id}`)}
                </button>
              ))}
            </div>
            <p className="widget-demo-note">{t('widget.demoNote')}</p>
          </div>
          <div className="widget-demo-stage">
            <DemoFrame key={`${demo.key}-${language}`} demo={demo} language={language} title={t(`widget.demo.${demo.id}`)} />
          </div>
        </section>

        <section className="widget-section" aria-labelledby="widget-steps-title">
          <h2 id="widget-steps-title">{t('widget.stepsTitle')}</h2>
          <ol className="widget-steps">
            {steps.map((step) => (
              <li key={step}>
                <h3>{t(`widget.steps.${step}.title`)}</h3>
                <p>{t(`widget.steps.${step}.body`)}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="widget-section widget-columns">
          <div>
            <h2>{t('widget.featuresTitle')}</h2>
            <ul className="widget-features">
              {features.map((feature) => <li key={feature}>{t(`widget.features.${feature}`)}</li>)}
            </ul>
          </div>
          <div>
            <h2>{t('widget.codeTitle')}</h2>
            <p>{t('widget.codeIntro')}</p>
            <pre className="widget-code"><code>{SNIPPET}</code></pre>
          </div>
        </section>

        <section className="widget-contact" aria-labelledby="widget-contact-title">
          <h2 id="widget-contact-title">{t('widget.ctaTitle')}</h2>
          <p>{t('widget.ctaBody')}</p>
          <a className="widget-cta-button" href={mailto}>{CONTACT_EMAIL}</a>
        </section>
      </div>
    </section></>
  );
}
