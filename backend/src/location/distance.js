const EARTH_RADIUS_KM = 6371.0088;
const toRadians = (degrees) => (degrees * Math.PI) / 180;

// Great-circle (haversine) distance in kilometres; null when any coordinate is missing.
export function distanceKm(latitude1, longitude1, latitude2, longitude2) {
  if ([latitude1, longitude1, latitude2, longitude2].some((value) => value === null || value === undefined || !Number.isFinite(Number(value)))) {
    return null;
  }
  const deltaLatitude = toRadians(latitude2 - latitude1);
  const deltaLongitude = toRadians(longitude2 - longitude1);
  const a = Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(toRadians(latitude1)) * Math.cos(toRadians(latitude2)) * Math.sin(deltaLongitude / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

// Latitude/longitude box that contains the circle, so SQLite can discard most rows before the
// exact distance is computed.
export function boundingBox(latitude, longitude, radiusKm) {
  const latitudeDelta = radiusKm / 111.32;
  const longitudeDelta = radiusKm / (111.32 * Math.max(Math.cos(toRadians(latitude)), 0.01));
  return {
    minLatitude: latitude - latitudeDelta,
    maxLatitude: latitude + latitudeDelta,
    minLongitude: longitude - longitudeDelta,
    maxLongitude: longitude + longitudeDelta,
  };
}
