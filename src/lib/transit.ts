import { COST, INTERCITY_RAIL, TRANSIT_ROUTE_FACTOR, TRANSIT_SPEED_KMH, TRANSIT_WAIT_S } from '../config';
import type { Leg, TransitHub } from '../types';
import { haversineM } from './geo';

/**
 * Estimate a transit leg between two hubs of the same kind.
 *
 * Mapbox has no transit routing, so this uses straight-line distance scaled by a
 * route factor, an average in-vehicle speed per hub kind, and a typical wait at
 * the boarding stop. Swap this for a GTFS/OpenTripPlanner client to get real
 * schedules — the rest of the planner only depends on the Leg shape.
 */
export function estimateTransitLeg(from: TransitHub, to: TransitHub): Leg {
  const kind = from.kind;
  const distanceM = haversineM(from.coord, to.coord) * TRANSIT_ROUTE_FACTOR;
  const speedKmh =
    kind === 'rail' && distanceM > INTERCITY_RAIL.minDistanceM
      ? INTERCITY_RAIL.speedKmh
      : TRANSIT_SPEED_KMH[kind];
  const inVehicleS = (distanceM / 1000 / speedKmh) * 3600;
  return {
    mode: 'transit',
    transitKind: kind,
    from,
    to,
    distanceM,
    durationS: inVehicleS + TRANSIT_WAIT_S[kind],
    geometry: { type: 'LineString', coordinates: [from.coord, to.coord] },
    cost: estimateFare(distanceM),
  };
}

export function estimateFare(distanceM: number): number {
  return COST.transitBaseFare + (distanceM / 1000) * COST.transitPerKm;
}
