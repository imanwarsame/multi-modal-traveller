import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useEffect, useRef } from 'react';
import { getToken } from '../lib/mapboxApi';
import type { Itinerary, Place } from '../types';

const MODE_COLORS: Record<string, string> = {
  walk: '#64748b',
  cycle: '#16a34a',
  drive: '#7c3aed',
  transit: '#ea580c',
};

const LINE_COLOR: mapboxgl.Expression = [
  'match',
  ['get', 'mode'],
  'walk', MODE_COLORS.walk,
  'cycle', MODE_COLORS.cycle,
  'drive', MODE_COLORS.drive,
  MODE_COLORS.transit,
];

interface Props {
  origin: Place | null;
  dest: Place | null;
  itineraries: Itinerary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

function legsToFeatures(itineraries: Itinerary[], selectedId: string | null) {
  const lines: GeoJSON.Feature[] = [];
  const transfers: GeoJSON.Feature[] = [];
  for (const it of itineraries) {
    const selected = it.id === selectedId;
    for (const [i, leg] of it.legs.entries()) {
      lines.push({
        type: 'Feature',
        geometry: leg.geometry,
        properties: {
          itinerary: it.id,
          mode: leg.mode,
          selected,
          // Dash estimated transit lines and walking to distinguish them.
          dashed: leg.mode === 'transit' || leg.mode === 'walk',
        },
      });
      if (selected && i > 0) {
        transfers.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: leg.from.coord },
          properties: { name: leg.from.name },
        });
      }
    }
  }
  return { lines, transfers };
}

export function MapView({ origin, dest, itineraries, selectedId, onSelect }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const loaded = useRef(false);
  const markers = useRef<mapboxgl.Marker[]>([]);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (!container.current || map.current) return;
    mapboxgl.accessToken = getToken();
    const m = new mapboxgl.Map({
      container: container.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [-0.1276, 51.5072],
      zoom: 11,
    });
    m.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
    m.on('load', () => {
      m.addSource('legs', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      m.addSource('transfers', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

      m.addLayer({
        id: 'legs-unselected',
        type: 'line',
        source: 'legs',
        filter: ['!', ['get', 'selected']],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': LINE_COLOR, 'line-width': 3, 'line-opacity': 0.25 },
      });
      m.addLayer({
        id: 'legs-selected-casing',
        type: 'line',
        source: 'legs',
        filter: ['get', 'selected'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#ffffff', 'line-width': 8 },
      });
      m.addLayer({
        id: 'legs-selected-solid',
        type: 'line',
        source: 'legs',
        filter: ['all', ['get', 'selected'], ['!', ['get', 'dashed']]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': LINE_COLOR, 'line-width': 4.5 },
      });
      m.addLayer({
        id: 'legs-selected-dashed',
        type: 'line',
        source: 'legs',
        filter: ['all', ['get', 'selected'], ['get', 'dashed']],
        paint: { 'line-color': LINE_COLOR, 'line-width': 4.5, 'line-dasharray': [0.5, 1.5] },
      });
      m.addLayer({
        id: 'transfer-points',
        type: 'circle',
        source: 'transfers',
        paint: {
          'circle-radius': 5,
          'circle-color': '#ffffff',
          'circle-stroke-width': 2.5,
          'circle-stroke-color': '#0f172a',
        },
      });

      m.on('click', 'legs-unselected', (e) => {
        const id = e.features?.[0]?.properties?.itinerary;
        if (id) onSelectRef.current(id);
      });
      m.on('mouseenter', 'legs-unselected', () => (m.getCanvas().style.cursor = 'pointer'));
      m.on('mouseleave', 'legs-unselected', () => (m.getCanvas().style.cursor = ''));

      loaded.current = true;
      updateData();
    });
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
      loaded.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateData() {
    const m = map.current;
    if (!m || !loaded.current) return;

    const { lines, transfers } = legsToFeatures(itineraries, selectedId);
    (m.getSource('legs') as mapboxgl.GeoJSONSource).setData({ type: 'FeatureCollection', features: lines });
    (m.getSource('transfers') as mapboxgl.GeoJSONSource).setData({ type: 'FeatureCollection', features: transfers });

    markers.current.forEach((mk) => mk.remove());
    markers.current = [];
    if (origin) {
      markers.current.push(
        new mapboxgl.Marker({ color: '#16a34a' }).setLngLat(origin.coord).addTo(m),
      );
    }
    if (dest) {
      markers.current.push(
        new mapboxgl.Marker({ color: '#dc2626' }).setLngLat(dest.coord).addTo(m),
      );
    }

    const focus = itineraries.find((it) => it.id === selectedId) ?? itineraries[0];
    if (focus) {
      const bounds = new mapboxgl.LngLatBounds();
      for (const leg of focus.legs) {
        for (const c of leg.geometry.coordinates) bounds.extend(c as [number, number]);
      }
      m.fitBounds(bounds, { padding: { top: 60, bottom: 60, left: 60, right: 60 }, maxZoom: 15 });
    } else if (origin && dest) {
      m.fitBounds(new mapboxgl.LngLatBounds(origin.coord, dest.coord), { padding: 80, maxZoom: 14 });
    } else if (origin || dest) {
      m.flyTo({ center: (origin ?? dest)!.coord, zoom: 13 });
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(updateData, [origin, dest, itineraries, selectedId]);

  return <div ref={container} className="map-container" />;
}
