import { describe, expect, it } from 'vitest';
import { formatCost, formatDistance, formatDuration, haversineM } from '../geo';

describe('haversineM', () => {
  it('returns 0 for identical points', () => {
    expect(haversineM([-0.1276, 51.5072], [-0.1276, 51.5072])).toBe(0);
  });

  it('measures London → Brighton at roughly 76 km', () => {
    const d = haversineM([-0.1276, 51.5072], [-0.1372, 50.8225]);
    expect(d).toBeGreaterThan(70_000);
    expect(d).toBeLessThan(82_000);
  });
});

describe('formatters', () => {
  it('formats durations', () => {
    expect(formatDuration(45)).toBe('1 min');
    expect(formatDuration(600)).toBe('10 min');
    expect(formatDuration(3600)).toBe('1 h');
    expect(formatDuration(5400)).toBe('1 h 30 min');
  });

  it('formats distances', () => {
    expect(formatDistance(340)).toBe('340 m');
    expect(formatDistance(2540)).toBe('2.5 km');
  });

  it('formats costs', () => {
    expect(formatCost(0)).toBe('Free');
    expect(formatCost(3.456)).toBe('£3.46');
  });
});
