import type { HubKind, LngLat, Place, TransitHub } from '../types';

const TOKEN_STORAGE_KEY = 'mmt-mapbox-token';

export function getToken(): string {
  return (
    (import.meta.env.VITE_MAPBOX_TOKEN as string | undefined) ??
    localStorage.getItem(TOKEN_STORAGE_KEY) ??
    ''
  );
}

export function saveToken(token: string): void {
  localStorage.setItem(TOKEN_STORAGE_KEY, token.trim());
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Mapbox request failed (${res.status}): ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

export interface GeocodeResult extends Place {
  id: string;
  context: string;
}

export async function geocode(query: string, proximity?: LngLat): Promise<GeocodeResult[]> {
  const params = new URLSearchParams({
    access_token: getToken(),
    autocomplete: 'true',
    limit: '5',
  });
  if (proximity) params.set('proximity', proximity.join(','));
  const data = await fetchJson<{
    features: { id: string; text: string; place_name: string; center: [number, number] }[];
  }>(
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?${params}`,
  );
  return data.features.map((f) => ({
    id: f.id,
    name: f.text,
    context: f.place_name,
    coord: f.center,
  }));
}

export type DirectionsProfile = 'walking' | 'cycling' | 'driving';

export interface RouteLeg {
  distanceM: number;
  durationS: number;
  geometry: GeoJSON.LineString;
}

export async function directions(
  profile: DirectionsProfile,
  from: LngLat,
  to: LngLat,
): Promise<RouteLeg> {
  const coords = `${from.join(',')};${to.join(',')}`;
  const params = new URLSearchParams({
    access_token: getToken(),
    geometries: 'geojson',
    overview: 'full',
  });
  const data = await fetchJson<{
    routes: { distance: number; duration: number; geometry: GeoJSON.LineString }[];
  }>(`https://api.mapbox.com/directions/v5/mapbox/${profile}/${coords}?${params}`);
  const route = data.routes[0];
  if (!route) throw new Error(`No ${profile} route found`);
  return { distanceM: route.distance, durationS: route.duration, geometry: route.geometry };
}

interface CategoryFeature {
  properties: { name: string };
  geometry: { coordinates: [number, number] };
}

async function categorySearch(
  category: string,
  proximity: LngLat,
  limit: number,
): Promise<Place[]> {
  const params = new URLSearchParams({
    access_token: getToken(),
    proximity: proximity.join(','),
    limit: String(limit),
  });
  const data = await fetchJson<{ features: CategoryFeature[] }>(
    `https://api.mapbox.com/search/searchbox/v1/category/${category}?${params}`,
  );
  return data.features.map((f) => ({
    name: f.properties.name,
    coord: f.geometry.coordinates,
  }));
}

const HUB_CATEGORIES: [string, HubKind][] = [
  ['railway_station', 'rail'],
  ['metro_station', 'metro'],
  ['bus_station', 'bus'],
];

/** Find transit hubs around a point, closest first. Categories that fail are skipped. */
export async function findTransitHubs(near: LngLat): Promise<TransitHub[]> {
  const results = await Promise.allSettled(
    HUB_CATEGORIES.map(async ([category, kind]) => {
      const places = await categorySearch(category, near, 4);
      return places.map((p): TransitHub => ({ ...p, kind }));
    }),
  );
  return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
}

export async function findParking(near: LngLat): Promise<Place[]> {
  return categorySearch('parking_lot', near, 6);
}
