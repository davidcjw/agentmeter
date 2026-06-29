import { describe, it, expect } from 'vitest';
import { normalizeModel, costForUsage, PRICING } from '../src/pricing.js';

describe('normalizeModel', () => {
  it('strips claude- prefix and date snapshot', () => {
    expect(normalizeModel('claude-haiku-4-5-20251001')).toBe('haiku-4-5');
    expect(normalizeModel('claude-opus-4-8')).toBe('opus-4-8');
    expect(normalizeModel('claude-sonnet-4-6')).toBe('sonnet-4-6');
    expect(normalizeModel('claude-fable-5')).toBe('fable-5');
  });

  it('returns null for synthetic and unknown models', () => {
    expect(normalizeModel('<synthetic>')).toBeNull();
    expect(normalizeModel('gpt-4')).toBeNull();
    expect(normalizeModel(null)).toBeNull();
  });

  it('every pricing key has input and output rates', () => {
    for (const [k, v] of Object.entries(PRICING)) {
      expect(v.input, k).toBeGreaterThan(0);
      expect(v.output, k).toBeGreaterThan(0);
    }
  });
});

describe('costForUsage', () => {
  it('prices plain input/output at the base rate', () => {
    const c = costForUsage({ input_tokens: 1_000_000, output_tokens: 1_000_000 }, 'claude-opus-4-8');
    expect(c.input).toBeCloseTo(5, 6);
    expect(c.output).toBeCloseTo(25, 6);
    expect(c.total).toBeCloseTo(30, 6);
    expect(c.priced).toBe(true);
  });

  it('prices cache read at 0.1x input', () => {
    const c = costForUsage({ cache_read_input_tokens: 1_000_000 }, 'claude-opus-4-8');
    expect(c.cacheRead).toBeCloseTo(0.5, 6);
  });

  it('prices the 5m/1h cache-creation split exactly', () => {
    const c = costForUsage(
      {
        cache_creation_input_tokens: 2_000_000,
        cache_creation: { ephemeral_5m_input_tokens: 1_000_000, ephemeral_1h_input_tokens: 1_000_000 },
      },
      'claude-opus-4-8'
    );
    // 5m: 1M * $5 * 1.25 = $6.25 ; 1h: 1M * $5 * 2 = $10
    expect(c.cacheWrite).toBeCloseTo(16.25, 6);
  });

  it('falls back to 5m rate when no split is present', () => {
    const c = costForUsage({ cache_creation_input_tokens: 1_000_000 }, 'claude-opus-4-8');
    expect(c.cacheWrite).toBeCloseTo(6.25, 6);
  });

  it('returns zero cost for unpriced models', () => {
    const c = costForUsage({ input_tokens: 1_000_000 }, '<synthetic>');
    expect(c.total).toBe(0);
    expect(c.priced).toBe(false);
  });
});
