import { COST, LIMITS } from '../config';
import type { Itinerary, Leg, LegMode, Place, PlanOptions, TransitHub } from '../types';
import { haversineM } from './geo';
import { directions, findParking, findTransitHubs, type DirectionsProfile } from './mapboxApi';
import { estimateTransitLeg } from './transit';

const PROFILE_FOR_MODE: Record<Exclude<LegMode, 'transit'>, DirectionsProfile> = {
  walk: 'walking',
  cycle: 'cycling',
  drive: 'driving',
};

const MODE_LABEL: Record<LegMode, string> = {
  walk: 'Walk',
  cycle: 'Cycle',
  drive: 'Drive',
  transit: 'Transit',
};

const TRANSIT_LABEL = { rail: 'Train', metro: 'Metro', bus: 'Bus' } as const;

const TRANSIT_ESTIMATE_NOTE =
  'Transit time and fare are estimates — check the live timetable before you set off.';

async function routedLeg(
  mode: Exclude<LegMode, 'transit'>,
  from: Place,
  to: Place,
  cost = 0,
): Promise<Leg> {
  const route = await directions(PROFILE_FOR_MODE[mode], from.coord, to.coord);
  const driveCost = mode === 'drive' ? (route.distanceM / 1000) * COST.drivePerKm : 0;
  return { mode, from, to, ...route, cost: cost + driveCost };
}

function legLabel(leg: Leg): string {
  return leg.mode === 'transit' ? TRANSIT_LABEL[leg.transitKind!] : MODE_LABEL[leg.mode];
}

function buildItinerary(id: string, legs: Leg[], notes: string[] = []): Itinerary {
  // Collapse consecutive same-mode legs in the label ("Walk → Train → Walk").
  const labels = legs.map(legLabel).filter((l, i, arr) => i === 0 || l !== arr[i - 1]);
  return {
    id,
    label: labels.join(' → '),
    legs,
    totalDurationS: legs.reduce((s, l) => s + l.durationS, 0),
    totalCost: legs.reduce((s, l) => s + l.cost, 0),
    notes,
  };
}

/**
 * Pick the origin-side and destination-side hub pair that covers the most of the
 * journey by transit. Hubs must share a kind (a bus stop can't connect to a rail
 * line in our estimator) and the transit leg must cover a meaningful share of
 * the trip, otherwise the transfers aren't worth it.
 */
export function pickHubPair(
  origin: Place,
  dest: Place,
  originHubs: TransitHub[],
  destHubs: TransitHub[],
): { board: TransitHub; alight: TransitHub } | null {
  const directM = haversineM(origin.coord, dest.coord);
  let best: { board: TransitHub; alight: TransitHub; score: number } | null = null;
  for (const board of originHubs) {
    for (const alight of destHubs) {
      if (board.kind !== alight.kind) continue;
      const transitM = haversineM(board.coord, alight.coord);
      if (transitM < directM * 0.4) continue; // hubs too close together to help
      const accessM =
        haversineM(origin.coord, board.coord) + haversineM(alight.coord, dest.coord);
      const score = transitM - 2 * accessM;
      if (!best || score > best.score) best = { board, alight, score };
    }
  }
  return best && { board: best.board, alight: best.alight };
}

function nearbyHubs(hubs: TransitHub[], near: Place): TransitHub[] {
  return hubs
    .filter((h) => haversineM(h.coord, near.coord) <= LIMITS.hubSearchRadiusM)
    .sort((a, b) => haversineM(a.coord, near.coord) - haversineM(b.coord, near.coord));
}

async function transitItinerary(
  origin: Place,
  dest: Place,
  accessMode: 'walk' | 'cycle',
  originHubs: TransitHub[],
  destHubs: TransitHub[],
): Promise<Itinerary | null> {
  const pair = pickHubPair(origin, dest, nearbyHubs(originHubs, origin), nearbyHubs(destHubs, dest));
  if (!pair) return null;
  const notes = [TRANSIT_ESTIMATE_NOTE];
  if (accessMode === 'cycle') {
    notes.push(`Check that bikes are allowed on this ${TRANSIT_LABEL[pair.board.kind].toLowerCase()} service.`);
  }
  const [access, egress] = await Promise.all([
    routedLeg(accessMode, origin, pair.board),
    routedLeg('walk', pair.alight, dest),
  ]);
  return buildItinerary(`${accessMode}-transit`, [access, estimateTransitLeg(pair.board, pair.alight), egress], notes);
}

async function parkNearDestination(origin: Place, dest: Place): Promise<Itinerary | null> {
  const lots = await findParking(dest.coord);
  const lot = lots
    .filter((p) => haversineM(p.coord, dest.coord) <= LIMITS.parkingWalkM)
    .sort((a, b) => haversineM(a.coord, dest.coord) - haversineM(b.coord, dest.coord))[0];
  if (!lot || haversineM(origin.coord, lot.coord) < 500) return null;
  const [drive, walk] = await Promise.all([
    routedLeg('drive', origin, lot, COST.parking),
    routedLeg('walk', lot, dest),
  ]);
  return buildItinerary('drive-park', [drive, walk], [
    `Parking cost is a flat estimate — ${lot.name} may charge by the hour.`,
  ]);
}

async function parkAndRide(
  origin: Place,
  dest: Place,
  originHubs: TransitHub[],
  destHubs: TransitHub[],
): Promise<Itinerary | null> {
  // Drive to an origin-side rail/metro hub, park there, ride in, walk out.
  const railHubs = nearbyHubs(originHubs, origin).filter((h) => h.kind !== 'bus');
  const pair = pickHubPair(origin, dest, railHubs, nearbyHubs(destHubs, dest));
  if (!pair || haversineM(origin.coord, pair.board.coord) < 1000) return null;
  const [drive, walk] = await Promise.all([
    routedLeg('drive', origin, pair.board, COST.stationParking),
    routedLeg('walk', pair.alight, dest),
  ]);
  return buildItinerary('park-and-ride', [drive, estimateTransitLeg(pair.board, pair.alight), walk], [
    TRANSIT_ESTIMATE_NOTE,
    `Assumes parking is available at ${pair.board.name}.`,
  ]);
}

export function rankItineraries(itineraries: Itinerary[], optimize: PlanOptions['optimize']): Itinerary[] {
  return [...itineraries].sort((a, b) =>
    optimize === 'cheapest'
      ? a.totalCost - b.totalCost || a.totalDurationS - b.totalDurationS
      : a.totalDurationS - b.totalDurationS || a.totalCost - b.totalCost,
  );
}

export async function planItineraries(
  origin: Place,
  dest: Place,
  opts: PlanOptions,
): Promise<Itinerary[]> {
  const directM = haversineM(origin.coord, dest.coord);
  if (directM < 50) throw new Error('Origin and destination are the same place.');

  const wantMultiModal = directM > LIMITS.multiModalMinM;
  const [originHubs, destHubs] = wantMultiModal
    ? await Promise.all([findTransitHubs(origin.coord), findTransitHubs(dest.coord)])
    : [[], []];

  const candidates: Promise<Itinerary | null>[] = [];

  if (directM <= LIMITS.walkDirectM) {
    candidates.push(routedLeg('walk', origin, dest).then((l) => buildItinerary('walk', [l])));
  }
  if (opts.hasBike && directM <= LIMITS.cycleDirectM) {
    candidates.push(routedLeg('cycle', origin, dest).then((l) => buildItinerary('cycle', [l])));
  }
  if (opts.hasCar) {
    candidates.push(
      routedLeg('drive', origin, dest, COST.parking).then((l) =>
        buildItinerary('drive', [l], ['Includes an estimated parking charge at the destination.']),
      ),
    );
  }
  if (wantMultiModal) {
    candidates.push(
      transitItinerary(origin, dest, opts.hasBike ? 'cycle' : 'walk', originHubs, destHubs),
    );
    if (opts.hasBike) {
      // Also offer the walk-based variant: no bike-carriage constraints.
      candidates.push(transitItinerary(origin, dest, 'walk', originHubs, destHubs));
    }
    if (opts.hasCar) {
      candidates.push(parkNearDestination(origin, dest));
      candidates.push(parkAndRide(origin, dest, originHubs, destHubs));
    }
  }

  const settled = await Promise.allSettled(candidates);
  const itineraries = settled
    .filter((r): r is PromiseFulfilledResult<Itinerary | null> => r.status === 'fulfilled')
    .map((r) => r.value)
    .filter((it): it is Itinerary => it !== null);

  // The same hub pair can produce identical walk-transit itineraries; dedupe by label.
  const seen = new Set<string>();
  const unique = itineraries.filter((it) => !seen.has(it.label) && seen.add(it.label));

  if (unique.length === 0) {
    const failure = settled.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    throw new Error(failure ? String(failure.reason) : 'No routes found for these options.');
  }
  return rankItineraries(unique, opts.optimize);
}
