import type { HubKind } from './types';

export const CURRENCY = '£';

/** In-vehicle average speeds for estimated transit legs, km/h. */
export const TRANSIT_SPEED_KMH: Record<HubKind, number> = {
  rail: 45,
  metro: 30,
  bus: 16,
};

/** Long rail hops run at intercity speeds rather than stopping-service speeds. */
export const INTERCITY_RAIL = { minDistanceM: 40_000, speedKmh: 90 };

/** Effective door-to-door driving speed used only for comparing candidate hubs. */
export const DRIVE_ESTIMATE_KMH = 50;

/** Typical wait at the boarding stop, seconds. */
export const TRANSIT_WAIT_S: Record<HubKind, number> = {
  rail: 600,
  metro: 300,
  bus: 420,
};

/** Track/road distance is longer than the straight line between two hubs. */
export const TRANSIT_ROUTE_FACTOR = 1.3;

export const COST = {
  /** Fuel + wear per driven km. */
  drivePerKm: 0.22,
  /** Flat estimate for city-centre parking near a destination. */
  parking: 5.0,
  /** Station park & ride car parks are usually cheaper. */
  stationParking: 3.0,
  transitBaseFare: 1.9,
  transitPerKm: 0.14,
};

/** Distance ceilings for suggesting a mode at all, metres. */
export const LIMITS = {
  walkDirectM: 3_000,
  cycleDirectM: 30_000,
  /** Below this, multi-modal combinations aren't worth the transfers. */
  multiModalMinM: 2_500,
  /** How far from origin/destination we look for transit hubs. */
  hubSearchRadiusM: 6_000,
  /** Max walk/cycle distance to reach parking near the destination. */
  parkingWalkM: 1_500,
  /** Trips longer than this get "drive most of the way, ride in" options. */
  driveAndRideMinM: 15_000,
  /** How far out from the destination to look for approach-side stations to park at. */
  approachStandoff: { fraction: 0.15, minM: 5_000, maxM: 15_000 },
};
