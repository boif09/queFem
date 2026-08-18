import { useState } from 'react';
import { useTranslation } from 'react-i18next';

function validCoordinate(value, minimum, maximum) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

export function hasValidCoordinates(latitude, longitude) {
  return validCoordinate(latitude, -90, 90) !== null
    && validCoordinate(longitude, -180, 180) !== null;
}

export function mapUrls(latitude, longitude) {
  const lat = validCoordinate(latitude, -90, 90);
  const lng = validCoordinate(longitude, -180, 180);
  if (lat === null || lng === null) return null;

  const latitudeDelta = 0.006;
  const longitudeDelta = 0.009;
  const bbox = [
    lng - longitudeDelta,
    lat - latitudeDelta,
    lng + longitudeDelta,
    lat + latitudeDelta,
  ].join(',');
  const embedParameters = new URLSearchParams({
    bbox,
    layer: 'mapnik',
    marker: `${lat},${lng}`,
  });
  const googleParameters = new URLSearchParams({
    api: '1',
    query: `${lat},${lng}`,
  });

  return {
    embed: `https://www.openstreetmap.org/export/embed.html?${embedParameters}`,
    google: `https://www.google.com/maps/search/?${googleParameters}`,
  };
}

export function MiniMap({ latitude, longitude }) {
  const { t } = useTranslation();
  const [mapLoaded, setMapLoaded] = useState(false);
  const urls = mapUrls(latitude, longitude);
  if (!urls) return null;

  return (
    <div className="mini-map">
      <div className="mini-map-frame">
        {mapLoaded ? (
          <>
            <iframe
              src={urls.embed}
              title={t('detail.mapTitle')}
              referrerPolicy="no-referrer"
              tabIndex="-1"
            />
            <a
              className="mini-map-link"
              href={urls.google}
              target="_blank"
              rel="noreferrer"
              aria-label={t('detail.openGoogleMaps')}
            >
              <span>{t('detail.openGoogleMaps')} <span aria-hidden="true">↗</span></span>
            </a>
          </>
        ) : (
          <button className="mini-map-placeholder" type="button" onClick={() => setMapLoaded(true)}>
            <strong>{t('detail.loadMap')}</strong>
            <span>{t('detail.mapLocation', { latitude, longitude })}</span>
          </button>
        )}
      </div>
      {mapLoaded && (
        <a
          className="map-attribution"
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noreferrer"
        >
          © OpenStreetMap contributors
        </a>
      )}
    </div>
  );
}
