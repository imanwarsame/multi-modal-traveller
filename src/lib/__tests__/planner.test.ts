import { describe, expect, it } from 'vitest';
import type { Itinerary, Place, TransitHub } from '../../types';
import { haversineM, pointToward } from '../geo';
import { pickApproachPair, pickHubPair, rankItineraries } from '../planner';
import { estimateTransitLeg } from '../transit';

const origin: Place = { name: 'Origin', coord: [-0.3, 51.5] };
const dest: Place = { name: 'Dest', coord: [0.0, 51.5] };

function hub(name: string, coord: [number, number], kind: TransitHub['kind'] = 'rail'): TransitHub {
  return { name, coord, kind };
}

describe('pickHubPair', () => {
  it('picks same-kind hubs that cover most of the trip', () => {
    const originHubs = [hub('Near Origin Rail', [-0.29, 51.5]), hub('Origin Bus', [-0.29, 51.51], 'bus')];
    const destHubs = [hub('Near Dest Rail', [-0.01, 51.5]), hub('Dest Metro', [-0.01, 51.49], 'metro')];
    const pair = pickHubPair(origin, dest, originHubs, destHubs);
    expect(pair?.board.name).toBe('Near Origin Rail');
    expect(pair?.alight.name).toBe('Near Dest Rail');
  });

  it('rejects pairs whose transit leg is too short to help', () => {
    // Both hubs sit next to the origin — riding between them covers nothing.
    const originHubs = [hub('A', [-0.29, 51.5])];
    const destHubs = [hub('B', [-0.28, 51.5])];
    expect(pickHubPair(origin, dest, originHubs, destHubs)).toBeNull();
  });

  it('never mixes hub kinds', () => {
    const originHubs = [hub('Origin Bus', [-0.29, 51.5], 'bus')];
    const destHubs = [hub('Dest Rail', [-0.01, 51.5], 'rail')];
    expect(pickHubPair(origin, dest, originHubs, destHubs)).toBeNull();
  });

  it('prefers the pair with less access distance when coverage ties', () => {
    const originHubs = [hub('Close', [-0.295, 51.5]), hub('Far', [-0.295, 51.55])];
    const destHubs = [hub('Alight', [-0.01, 51.5])];
    const pair = pickHubPair(origin, dest, originHubs, destHubs);
    expect(pair?.board.name).toBe('Close');
  });
});

describe('pointToward', () => {
  it('lands the requested distance along the way', () => {
    const p = pointToward([0, 51.5], [-1.4, 50.9], 10_000);
    expect(haversineM([0, 51.5], p)).toBeCloseTo(10_000, -3);
  });

  it('clamps to the target when the target is closer than the distance', () => {
    expect(pointToward([0, 51.5], [0.01, 51.5], 10_000)).toEqual([0.01, 51.5]);
  });
});

describe('pickApproachPair', () => {
  // Southampton → central London: park at a west-London metro hub and ride in.
  const soton: Place = { name: 'Southampton', coord: [-1.4044, 50.9097] };
  const london: Place = { name: 'Covent Garden', coord: [-0.1226, 51.5117] };

  it('parks at the approach-side hub, not one beyond the destination', () => {
    const westHub = hub('West London Metro', [-0.28, 51.49], 'metro');
    const eastHub = hub('East London Metro', [0.05, 51.51], 'metro'); // past the centre
    const alight = hub('Central Metro', [-0.125, 51.51], 'metro');
    const pair = pickApproachPair(soton, london, [westHub, eastHub], [alight]);
    expect(pair?.board.name).toBe('West London Metro');
    expect(pair?.alight.name).toBe('Central Metro');
  });

  it('accepts short transit hops (no minimum-coverage rule)', () => {
    // 8 km hop vs a 110 km trip would be rejected by pickHubPair.
    const board = hub('Approach Hub', [-0.24, 51.5], 'metro');
    const alight = hub('Central Hub', [-0.125, 51.51], 'metro');
    expect(pickHubPair(soton, london, [board], [alight])).toBeNull();
    expect(pickApproachPair(soton, london, [board], [alight])).not.toBeNull();
  });

  it('rejects hops too short to beat just driving there', () => {
    const board = hub('A', [-0.13, 51.511], 'metro');
    const alight = hub('B', [-0.125, 51.51], 'metro');
    expect(pickApproachPair(soton, london, [board], [alight])).toBeNull();
  });
});

describe('estimateTransitLeg', () => {
  it('rail is faster than bus over the same hop', () => {
    const a = hub('A', [-0.3, 51.5]);
    const bRail = hub('B', [0.0, 51.5]);
    const aBus = hub('A', [-0.3, 51.5], 'bus');
    const bBus = hub('B', [0.0, 51.5], 'bus');
    expect(estimateTransitLeg(a, bRail).durationS).toBeLessThan(
      estimateTransitLeg(aBus, bBus).durationS,
    );
  });

  it('includes waiting time and a positive fare', () => {
    const leg = estimateTransitLeg(hub('A', [-0.3, 51.5]), hub('B', [-0.25, 51.5]));
    expect(leg.durationS).toBeGreaterThan(600); // at least the rail wait
    expect(leg.cost).toBeGreaterThan(0);
  });
});

describe('rankItineraries', () => {
  const make = (id: string, durationS: number, cost: number): Itinerary => ({
    id,
    label: id,
    legs: [],
    totalDurationS: durationS,
    totalCost: cost,
    notes: [],
  });

  it('sorts by duration when optimizing for fastest', () => {
    const ranked = rankItineraries([make('slow', 4000, 0), make('fast', 1000, 9)], 'fastest');
    expect(ranked.map((i) => i.id)).toEqual(['fast', 'slow']);
  });

  it('sorts by cost when optimizing for cheapest', () => {
    const ranked = rankItineraries([make('pricey', 1000, 9), make('free', 4000, 0)], 'cheapest');
    expect(ranked.map((i) => i.id)).toEqual(['free', 'pricey']);
  });
});
