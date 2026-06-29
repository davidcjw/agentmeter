import { describe, it, expect } from 'vitest';
import { sparkline, cacheHitRatio, dailySeries } from '../src/report.js';

describe('sparkline', () => {
  it('maps zero to · and scales the rest', () => {
    const s = sparkline([0, 1, 10]);
    expect(s).toHaveLength(3);
    expect(s[0]).toBe('·');
    expect(s[2]).toBe('█'); // the max value gets the tallest bar
  });

  it('handles an all-zero series', () => {
    expect(sparkline([0, 0, 0])).toBe('···');
  });
});

describe('cacheHitRatio', () => {
  it('is cacheRead over total prompt tokens', () => {
    expect(cacheHitRatio({ input: 100, cacheRead: 300, cacheCreation: 100 })).toBeCloseTo(0.6, 6);
  });
  it('is 0 when there are no prompt tokens', () => {
    expect(cacheHitRatio({ input: 0, cacheRead: 0, cacheCreation: 0 })).toBe(0);
  });
});

describe('dailySeries', () => {
  it('fills gaps between the first and last active day', () => {
    const byDay = [
      { day: '2026-06-01', cost: { total: 5 } },
      { day: '2026-06-03', cost: { total: 7 } },
    ];
    const series = dailySeries(byDay, 14);
    expect(series.map((s) => s.day)).toEqual(['2026-06-01', '2026-06-02', '2026-06-03']);
    expect(series[1].cost).toBe(0); // gap day
    expect(series[2].cost).toBe(7);
  });

  it('caps the window to the requested number of days', () => {
    const byDay = Array.from({ length: 40 }, (_, i) => ({
      day: `2026-06-${String(i + 1).padStart(2, '0')}`,
      cost: { total: 1 },
    })).filter((e) => Number(e.day.slice(-2)) <= 30); // June has 30 days
    const series = dailySeries(byDay, 14);
    expect(series).toHaveLength(14);
    expect(series[series.length - 1].day).toBe('2026-06-30');
  });

  it('returns empty for no data', () => {
    expect(dailySeries([], 14)).toEqual([]);
  });
});
