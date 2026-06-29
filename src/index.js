import { resolve } from 'node:path';
import { discover, defaultRoot } from './discover.js';
import { aggregate, parseSince } from './aggregate.js';
import { renderText, toJSON } from './report.js';

export { discover, defaultRoot, projectLabel } from './discover.js';
export { parseTranscript } from './parse.js';
export { aggregate, parseSince } from './aggregate.js';
export { costForUsage, normalizeModel, PRICING } from './pricing.js';
export {
  renderText,
  renderEfficiency,
  toJSON,
  formatTokens,
  formatUSD,
  sparkline,
  cacheHitRatio,
  dailySeries,
} from './report.js';

/**
 * Discover transcripts under a root and aggregate them into a report.
 *
 * @param {object} [opts]
 * @param {string} [opts.path] transcript root (default ~/.claude/projects)
 * @param {string} [opts.since] window like "7d" / "24h" / ISO date
 * @param {string} [opts.home] override home dir (for testing)
 * @param {number} [opts.now] epoch ms reference for --since (for testing)
 * @returns {{ root: string, files: object[], result: object }}
 */
export function run(opts = {}) {
  const root = opts.path ? resolve(opts.path) : defaultRoot(opts.home);
  const files = discover(root);
  const sinceMs = parseSince(opts.since, opts.now);
  const result = aggregate(files, { sinceMs });
  return { root, files, result };
}

/**
 * Convenience: run and render to a string.
 * @param {object} [opts] run() opts plus { json, color }
 * @returns {string}
 */
export function report(opts = {}) {
  const { root, result } = run(opts);
  if (opts.json) return JSON.stringify(toJSON(result, { root }), null, 2);
  return renderText(result, { root, color: opts.color });
}
