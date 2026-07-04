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

export interface Suggestion {
  id: string;
  name: string;
  context: string;
}

/**
 * Interactive search via the Search Box API: `suggest` matches fuzzy queries,
 * city names, POIs and landmarks — not just exact addresses. Coordinates come
 * from a follow-up `retrieve` call using the same session token.
 */
export async function suggest(
  query: string,
  sessionToken: string,
  proximity?: LngLat,
): Promise<Suggestion[]> {
  const params = new URLSearchParams({
    q: query,
    access_token: getToken(),
    session_token: sessionToken,
    limit: '6',
  });
  if (proximity) params.set('proximity', proximity.join(','));
  if (navigator.language) params.set('language', navigator.language.split('-')[0]);
  const data = await fetchJson<{
    suggestions: { mapbox_id: string; name: string; place_formatted?: string }[];
  }>(`https://api.mapbox.com/search/searchbox/v1/suggest?${params}`);
  return data.suggestions.map((s) => ({
    id: s.mapbox_id,
    name: s.name,
    context: s.place_formatted ?? '',
  }));
}

export async function retrieve(id: string, sessionToken: string): Promise<Place> {
  const params = new URLSearchParams({ access_token: getToken(), session_token: sessionToken });
  const data = await fetchJson<{
    features: { geometry: { coordinates: [number, number] }; properties: { name: string } }[];
  }>(`https://api.mapbox.com/search/searchbox/v1/retrieve/${encodeURIComponent(id)}?${params}`);
  const f = data.features[0];
  if (!f) throw new Error('Could not resolve that place.');
  return { name: f.properties.name, coord: f.geometry.coordinates };
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

/** Find transit hubs of the given kinds around a point. Categories that fail are skipped. */
export async function findTransitHubs(near: LngLat, kinds: HubKind[]): Promise<TransitHub[]> {
  const results = await Promise.allSettled(
    HUB_CATEGORIES.filter(([, kind]) => kinds.includes(kind)).map(async ([category, kind]) => {
      const places = await categorySearch(category, near, 4);
      return places.map((p): TransitHub => ({ ...p, kind }));
    }),
  );
  return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
}

export async function findParking(near: LngLat): Promise<Place[]> {
  return categorySearch('parking_lot', near, 6);
}
