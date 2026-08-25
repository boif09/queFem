import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { readAndVerifyIcgcSnapshot } from './icgcSnapshot.js';

function territory(properties) {
  return {
    municipality: { code: properties.CODIMUNI, name: properties.NOMMUNI },
    comarca: { code: properties.CODICOMAR, name: properties.NOMCOMAR },
    province: { code: properties.CODIPROV, name: properties.NOMPROV },
  };
}

export class CataloniaAdministrativeResolver {
  constructor(snapshot, metadata) {
    this.features = snapshot.features;
    this.metadata = metadata;
  }

  static async fromManifest(manifestPath) {
    const loaded = await readAndVerifyIcgcSnapshot(manifestPath);
    return new CataloniaAdministrativeResolver(loaded.snapshot, loaded.metadata);
  }

  resolve({ latitude, longitude }) {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
      || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      throw new TypeError('Valid latitude and longitude are required');
    }
    const point = [longitude, latitude];
    const bboxCandidates = this.features.filter(({ bbox }) => longitude >= bbox[0]
      && longitude <= bbox[2] && latitude >= bbox[1] && latitude <= bbox[3]);
    const matches = bboxCandidates.filter((feature) => booleanPointInPolygon(point, feature));
    const source = {
      provider: this.metadata.provider,
      datasetDate: this.metadata.datasetDate,
      layer: this.metadata.layer,
    };
    const diagnostics = {
      bboxCandidates: bboxCandidates.length,
      suspicious: latitude === 0 && longitude === 0,
    };
    if (matches.length === 1) return { status: 'match', ...territory(matches[0].properties), source, diagnostics };
    if (matches.length === 0) return { status: 'unresolved', candidates: [], source, diagnostics };
    return {
      status: 'ambiguous',
      candidates: matches.map(({ properties }) => territory(properties)),
      source,
      diagnostics,
    };
  }
}
