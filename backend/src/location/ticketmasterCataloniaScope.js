import { normalizeForFingerprint } from '../normalizers/text.normalizer.js';

const PROVINCES = new Map([
  ['barcelona', 'Barcelona'], ['girona', 'Girona'], ['gerona', 'Girona'],
  ['lleida', 'Lleida'], ['lerida', 'Lleida'], ['tarragona', 'Tarragona'],
]);
const POSTAL_PREFIXES = new Set(['08', '17', '25', '43']);

function field(record, ...names) {
  for (const name of names) if (record?.[name] !== undefined && record[name] !== null) return record[name];
  return null;
}

export function ticketmasterLocation(record) {
  const venue = record.venue || {};
  const country = String(field(venue, 'countryCode', 'venueCountryCode') || field(record, 'countryCode') || '').toUpperCase();
  const rawProvince = field(venue, 'state', 'stateName', 'venueState', 'venueStateCode', 'province');
  const province = PROVINCES.get(normalizeForFingerprint(rawProvince)) || null;
  const postalCode = String(field(venue, 'postalCode', 'venuePostalCode', 'venueZipCode') || '').trim() || null;
  const postalProvince = postalCode && POSTAL_PREFIXES.has(postalCode.slice(0, 2));
  const latitude = Number(field(venue, 'latitude', 'lat', 'venueLatitude'));
  const longitude = Number(field(venue, 'longitude', 'lon', 'lng', 'venueLongitude'));
  const coordinatesValid = Number.isFinite(latitude) && Number.isFinite(longitude);
  const coordinatesContradict = coordinatesValid
    && (latitude < 40.45 || latitude > 42.95 || longitude < 0.0 || longitude > 3.45);
  const confirmed = country === 'ES' && Boolean(province || postalProvince) && !coordinatesContradict;
  return {
    confirmed,
    province: province || (postalProvince ? PROVINCES.get(new Map([['08','barcelona'],['17','girona'],['25','lleida'],['43','tarragona']]).get(postalCode.slice(0, 2))) : null),
    municipality: field(venue, 'city', 'cityName', 'venueCity'),
    locality: field(venue, 'city', 'cityName', 'venueCity'),
    address: field(venue, 'address', 'addressLine1', 'venueStreet'),
    postalCode,
    venueName: field(venue, 'venueName', 'name'),
    latitude: coordinatesValid ? latitude : null,
    longitude: coordinatesValid ? longitude : null,
  };
}
