// The single maintenance point. Prices are USD per million tokens, sourced from
// the Anthropic pricing table. Update here when models or prices change.
//
// Cache multipliers (applied to the model's *input* rate):
//   - cache write, 5-minute TTL: 1.25x
//   - cache write, 1-hour TTL:   2.0x
//   - cache read:                0.1x

export const CACHE_WRITE_5M = 1.25;
export const CACHE_WRITE_1H = 2.0;
export const CACHE_READ = 0.1;

const M = 1_000_000;

// Keyed by a normalized model family. { input, output } per million tokens.
export const PRICING = {
  'opus-4-8': { input: 5, output: 25 },
  'opus-4-7': { input: 5, output: 25 },
  'opus-4-6': { input: 5, output: 25 },
  'opus-4-5': { input: 5, output: 25 },
  'opus-4-1': { input: 15, output: 75 },
  'opus-4-0': { input: 15, output: 75 },
  'sonnet-4-6': { input: 3, output: 15 },
  'sonnet-4-5': { input: 3, output: 15 },
  'sonnet-4-0': { input: 3, output: 15 },
  'haiku-4-5': { input: 1, output: 5 },
  'fable-5': { input: 10, output: 50 },
  'mythos-5': { input: 10, output: 50 },
};

/**
 * Normalize a raw model id (e.g. "claude-haiku-4-5-20251001") to a pricing key
 * (e.g. "haiku-4-5"). Returns null for ids we don't price (e.g. "<synthetic>").
 * @param {string} model
 * @returns {string|null}
 */
export function normalizeModel(model) {
  if (!model || typeof model !== 'string') return null;
  if (model === '<synthetic>') return null;
  // Strip the "claude-" prefix and any trailing date snapshot ("-20251001").
  let m = model.replace(/^claude-/, '').replace(/-\d{8}$/, '');
  if (PRICING[m]) return m;
  // Fall back to the family + first two version segments (e.g. "opus-4-8-foo").
  const parts = m.split('-');
  if (parts.length >= 3) {
    const key = `${parts[0]}-${parts[1]}-${parts[2]}`;
    if (PRICING[key]) return key;
  }
  if (parts.length >= 2) {
    const key = `${parts[0]}-${parts[1]}`;
    if (PRICING[key]) return key;
  }
  return null;
}

/**
 * Cost of a single assistant message's usage block, in USD.
 *
 * @param {object} usage the Anthropic `message.usage` object
 * @param {string} model the raw model id from the record
 * @returns {{ total: number, input: number, output: number, cacheWrite: number,
 *            cacheRead: number, priced: boolean }}
 */
export function costForUsage(usage, model) {
  const key = normalizeModel(model);
  const price = key ? PRICING[key] : null;
  if (!usage || !price) {
    return { total: 0, input: 0, output: 0, cacheWrite: 0, cacheRead: 0, priced: Boolean(price) };
  }

  const input = ((usage.input_tokens || 0) / M) * price.input;
  const output = ((usage.output_tokens || 0) / M) * price.output;
  const cacheRead = ((usage.cache_read_input_tokens || 0) / M) * price.input * CACHE_READ;

  // Prefer the exact 5m/1h split when present; otherwise treat all cache
  // creation as the 5-minute tier.
  const cc = usage.cache_creation;
  let cacheWrite;
  if (cc && (cc.ephemeral_5m_input_tokens != null || cc.ephemeral_1h_input_tokens != null)) {
    const w5 = ((cc.ephemeral_5m_input_tokens || 0) / M) * price.input * CACHE_WRITE_5M;
    const w1 = ((cc.ephemeral_1h_input_tokens || 0) / M) * price.input * CACHE_WRITE_1H;
    cacheWrite = w5 + w1;
  } else {
    cacheWrite = ((usage.cache_creation_input_tokens || 0) / M) * price.input * CACHE_WRITE_5M;
  }

  return {
    total: input + output + cacheRead + cacheWrite,
    input,
    output,
    cacheWrite,
    cacheRead,
    priced: true,
  };
}
