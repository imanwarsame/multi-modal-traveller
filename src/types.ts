export type LngLat = [number, number];

export interface Place {
  name: string;
  coord: LngLat;
}

export type HubKind = 'rail' | 'metro' | 'bus';

export interface TransitHub extends Place {
  kind: HubKind;
}

export type LegMode = 'walk' | 'cycle' | 'drive' | 'transit';

export interface Leg {
  mode: LegMode;
  from: Place;
  to: Place;
  distanceM: number;
  durationS: number;
  geometry: GeoJSON.LineString;
  /** Set for transit legs. */
  transitKind?: HubKind;
  /** Estimated cost of this leg (fuel, fare, parking...). */
  cost: number;
}

export interface Itinerary {
  id: string;
  label: string;
  legs: Leg[];
  totalDurationS: number;
  totalCost: number;
  notes: string[];
}

export type Optimize = 'fastest' | 'cheapest';

export interface PlanOptions {
  hasBike: boolean;
  hasCar: boolean;
  optimize: Optimize;
}
