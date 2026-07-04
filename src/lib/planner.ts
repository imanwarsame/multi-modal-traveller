import { COST, DRIVE_ESTIMATE_KMH, LIMITS, TRANSIT_SPEED_KMH } from '../config';
import type {
  HubKind,
  Itinerary,
  Leg,
  LegMode,
  Place,
  PlanOptions,
  TransitHub,
  TravelMode,
} from '../types';
import { haversineM, pointToward } from './geo';
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

const TRANSIT_KINDS: HubKind[] = ['rail', 'metro', 'bus'];

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

/**
 * Pick where to leave the car on the way in: the (board, alight) pair that
 * minimises rough drive + ride + walk time. Unlike pickHubPair there is no
 * minimum-coverage rule — the transit leg only handles the final approach into
 * the centre, however long the drive before it was.
 */
export function pickApproachPair(
  origin: Place,
  dest: Place,
  boardHubs: TransitHub[],
  alightHubs: TransitHub[],
): { board: TransitHub; alight: TransitHub } | null {
  let best: { board: TransitHub; alight: TransitHub; estS: number } | null = null;
  for (const board of boardHubs) {
    for (const alight of alightHubs) {
      if (board.kind !== alight.kind) continue;
      const transitM = haversineM(board.coord, alight.coord);
      if (transitM < 1500) continue; // pointless hop
      const estS =
        haversineM(origin.coord, board.coord) / (DRIVE_ESTIMATE_KMH / 3.6) +
        transitM / (TRANSIT_SPEED_KMH[board.kind] / 3.6) +
        haversineM(alight.coord, dest.coord) / 1.3;
      if (!best || estS < best.estS) best = { board, alight, estS };
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

/**
 * Long-trip pattern: drive most of the way, park at a station on the approach
 * side of the destination (e.g. a west-London tube station when coming from
 * Southampton), and ride transit into the centre.
 */
async function driveAndRide(
  origin: Place,
  dest: Place,
  destHubs: TransitHub[],
  kinds: HubKind[],
): Promise<Itinerary | null> {
  const directM = haversineM(origin.coord, dest.coord);
  if (directM < LIMITS.driveAndRideMinM) return null;
  const rideKinds = kinds.filter((k) => k !== 'bus');
  const useKinds = rideKinds.length > 0 ? rideKinds : kinds;

  const { fraction, minM, maxM } = LIMITS.approachStandoff;
  const standoffM = Math.min(Math.max(directM * fraction, minM), maxM);
  const approach = pointToward(dest.coord, origin.coord, standoffM);

  const boardHubs = (await findTransitHubs(approach, useKinds)).filter(
    (h) => haversineM(h.coord, dest.coord) > 2500, // stay out of the centre
  );
  const alightHubs = nearbyHubs(destHubs, dest).filter((h) => useKinds.includes(h.kind));
  const pair = pickApproachPair(origin, dest, boardHubs, alightHubs);
  if (!pair) return null;

  const [drive, walk] = await Promise.all([
    routedLeg('drive', origin, pair.board, COST.stationParking),
    routedLeg('walk', pair.alight, dest),
  ]);
  return buildItinerary('drive-and-ride', [drive, estimateTransitLeg(pair.board, pair.alight), walk], [
    TRANSIT_ESTIMATE_NOTE,
    `Park near ${pair.board.name} and ride in — skips driving into the centre.`,
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
  const allowed = new Set<TravelMode>(opts.modes);
  if (allowed.size === 0) throw new Error('Enable at least one travel mode.');
  const directM = haversineM(origin.coord, dest.coord);
  if (directM < 50) throw new Error('Origin and destination are the same place.');

  const kinds = TRANSIT_KINDS.filter((k) => allowed.has(k));
  const wantTransit = kinds.length > 0 && directM > LIMITS.multiModalMinM;
  const [originHubs, destHubs] = wantTransit
    ? await Promise.all([findTransitHubs(origin.coord, kinds), findTransitHubs(dest.coord, kinds)])
    : [[], []];

  const candidates: Promise<Itinerary | null>[] = [];

  if (allowed.has('walk') && directM <= LIMITS.walkDirectM) {
    candidates.push(routedLeg('walk', origin, dest).then((l) => buildItinerary('walk', [l])));
  }
  if (allowed.has('cycle') && directM <= LIMITS.cycleDirectM) {
    candidates.push(routedLeg('cycle', origin, dest).then((l) => buildItinerary('cycle', [l])));
  }
  if (allowed.has('drive')) {
    candidates.push(
      routedLeg('drive', origin, dest, COST.parking).then((l) =>
        buildItinerary('drive', [l], ['Includes an estimated parking charge at the destination.']),
      ),
    );
    if (directM > LIMITS.multiModalMinM) {
      candidates.push(parkNearDestination(origin, dest));
    }
  }
  if (wantTransit) {
    if (allowed.has('cycle')) {
      candidates.push(transitItinerary(origin, dest, 'cycle', originHubs, destHubs));
    }
    if (allowed.has('walk') || (!allowed.has('cycle') && !allowed.has('drive'))) {
      // Walk-access variant: no bike-carriage constraints; also the only way
      // to reach a station at all when neither cycling nor driving is enabled.
      candidates.push(transitItinerary(origin, dest, 'walk', originHubs, destHubs));
    }
    if (allowed.has('drive')) {
      candidates.push(parkAndRide(origin, dest, originHubs, destHubs));
      candidates.push(driveAndRide(origin, dest, destHubs, kinds));
    }
  }

  const settled = await Promise.allSettled(candidates);
  const itineraries = settled
    .filter((r): r is PromiseFulfilledResult<Itinerary | null> => r.status === 'fulfilled')
    .map((r) => r.value)
    .filter((it): it is Itinerary => it !== null);

  if (itineraries.length === 0) {
    const failure = settled.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    throw new Error(failure ? String(failure.reason) : 'No routes found for these options.');
  }

  // Rank first, then dedupe by label so the better of two same-shaped
  // itineraries (e.g. both "Drive → Train → Walk") is the one that survives.
  const ranked = rankItineraries(itineraries, opts.optimize);
  const seen = new Set<string>();
  return ranked.filter((it) => !seen.has(it.label) && seen.add(it.label));
}
