import { parseTranscript } from './parse.js';
import { projectLabel } from './discover.js';
import { costForUsage, normalizeModel } from './pricing.js';
import { createEfficiencyAccumulator } from './efficiency.js';

function newCost() {
  return { total: 0, input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
}
function addCost(acc, c) {
  acc.total += c.total;
  acc.input += c.input;
  acc.output += c.output;
  acc.cacheWrite += c.cacheWrite;
  acc.cacheRead += c.cacheRead;
}

function bump(map, key, cost) {
  let e = map.get(key);
  if (!e) {
    e = { messages: 0, cost: newCost() };
    map.set(key, e);
  }
  e.messages += 1;
  addCost(e.cost, cost);
  return e;
}

function sortedByCost(map, nameKey) {
  return [...map.entries()]
    .map(([name, e]) => ({ [nameKey]: name, messages: e.messages, cost: e.cost }))
    .sort((a, b) => b.cost.total - a.cost.total);
}

/**
 * Aggregate a set of transcript files into a usage/cost report.
 *
 * @param {Array<{file: string, projectDir: string}>} files from discover()
 * @param {object} [opts]
 * @param {number} [opts.sinceMs] epoch ms cutoff; records older than this are dropped
 * @returns {object} report (see README for the shape)
 */
export function aggregate(files, opts = {}) {
  const sinceMs = opts.sinceMs;

  let sessions = 0;
  let messages = 0;
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0 };
  const cost = newCost();
  const serverTools = { webSearch: 0, webFetch: 0 };

  const byModel = new Map();
  const byProject = new Map();
  const byDay = new Map();
  const byTool = new Map();
  const bySkill = new Map();
  const byPlugin = new Map();
  const byMcpServer = new Map();
  const unpricedModels = new Map();
  let unpricedMessages = 0;

  const subagent = { main: { messages: 0, cost: newCost() }, sidechain: { messages: 0, cost: newCost() } };
  const eff = createEfficiencyAccumulator();

  let firstTs = null;
  let lastTs = null;

  const inWindow = (ts) => {
    if (sinceMs == null) return true;
    const t = ts ? Date.parse(ts) : NaN;
    return !Number.isNaN(t) && t >= sinceMs;
  };

  for (const { file, projectDir } of files) {
    const { records, toolUses, toolResults, interrupts, cwd } = parseTranscript(file);

    // Efficiency analysis (own since-filter; runs even when a file has no usage records).
    const tu = sinceMs == null ? toolUses : toolUses.filter((u) => inWindow(u.ts));
    const tr = sinceMs == null ? toolResults : toolResults.filter((r) => inWindow(r.ts));
    const ints = sinceMs == null ? interrupts : interrupts.filter((ts) => inWindow(ts));
    if (tu.length || tr.length || ints.length) eff.addSession(tu, tr, ints.length);

    if (!records.length) continue;
    const label = projectLabel(projectDir, cwd);

    let sessionHadRecord = false;
    for (const rec of records) {
      const ts = rec.timestamp ? Date.parse(rec.timestamp) : NaN;
      if (sinceMs != null) {
        if (Number.isNaN(ts) || ts < sinceMs) continue;
      }
      sessionHadRecord = true;

      const c = costForUsage(rec.usage, rec.model);
      const u = rec.usage;

      messages += 1;
      tokens.input += u.input_tokens || 0;
      tokens.output += u.output_tokens || 0;
      tokens.cacheRead += u.cache_read_input_tokens || 0;
      tokens.cacheCreation += u.cache_creation_input_tokens || 0;
      addCost(cost, c);
      serverTools.webSearch += rec.webSearch;
      serverTools.webFetch += rec.webFetch;

      if (rec.model && !c.priced) {
        unpricedMessages += 1;
        unpricedModels.set(rec.model, (unpricedModels.get(rec.model) || 0) + 1);
      }

      const modelKey = normalizeModel(rec.model) || rec.model || '(unknown)';
      bump(byModel, modelKey, c);
      bump(byProject, label, c);
      if (!Number.isNaN(ts)) {
        const day = new Date(ts).toISOString().slice(0, 10);
        bump(byDay, day, c);
      }
      for (const t of rec.tools) {
        byTool.set(t, (byTool.get(t) || 0) + 1);
      }
      if (rec.attribution.skill) bump(bySkill, rec.attribution.skill, c);
      if (rec.attribution.plugin) bump(byPlugin, rec.attribution.plugin, c);
      if (rec.attribution.mcpServer) bump(byMcpServer, rec.attribution.mcpServer, c);

      const lane = rec.isSidechain ? subagent.sidechain : subagent.main;
      lane.messages += 1;
      addCost(lane.cost, c);

      if (rec.timestamp) {
        if (!firstTs || rec.timestamp < firstTs) firstTs = rec.timestamp;
        if (!lastTs || rec.timestamp > lastTs) lastTs = rec.timestamp;
      }
    }
    if (sessionHadRecord) sessions += 1;
  }

  tokens.total = tokens.input + tokens.output + tokens.cacheRead + tokens.cacheCreation;

  return {
    sessions,
    filesScanned: files.length,
    sinceMs: sinceMs ?? null,
    messages,
    tokens,
    cost,
    serverTools,
    byModel: sortedByCost(byModel, 'model'),
    byProject: sortedByCost(byProject, 'project'),
    byDay: [...byDay.entries()]
      .map(([day, e]) => ({ day, messages: e.messages, cost: e.cost }))
      .sort((a, b) => (a.day < b.day ? -1 : 1)),
    byTool: [...byTool.entries()]
      .map(([tool, calls]) => ({ tool, calls }))
      .sort((a, b) => b.calls - a.calls),
    bySkill: sortedByCost(bySkill, 'skill'),
    byPlugin: sortedByCost(byPlugin, 'plugin'),
    byMcpServer: sortedByCost(byMcpServer, 'server'),
    subagent,
    unpriced: {
      messages: unpricedMessages,
      models: Object.fromEntries(unpricedModels),
    },
    efficiency: eff.finalize(),
    firstTs,
    lastTs,
  };
}

/**
 * Parse a --since value into an epoch-ms cutoff relative to `now`.
 * Accepts "7d", "24h", "90m", or an ISO date/datetime. Returns null for falsy.
 * @param {string} value
 * @param {number} [now] epoch ms (defaults to Date.now())
 * @returns {number|null}
 * @throws if the value can't be parsed
 */
export function parseSince(value, now = Date.now()) {
  if (!value) return null;
  const rel = /^(\d+)\s*([dhm])$/.exec(value.trim());
  if (rel) {
    const n = Number(rel[1]);
    const unit = { d: 86_400_000, h: 3_600_000, m: 60_000 }[rel[2]];
    return now - n * unit;
  }
  const t = Date.parse(value);
  if (Number.isNaN(t)) {
    throw new Error(`invalid --since value: "${value}" (use e.g. 7d, 24h, 90m, or a date)`);
  }
  return t;
}
