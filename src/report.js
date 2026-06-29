const RESET = '\x1b[0m';
const STYLES = {
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

function makeColor(enabled) {
  return (style, text) =>
    enabled && STYLES[style] ? `${STYLES[style]}${text}${RESET}` : String(text);
}

const RULE = '─'.repeat(52);
const TOP_N = 10;

export function formatTokens(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function formatUSD(n) {
  if (n > 0 && n < 0.01) return '<$0.01';
  const s = n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `$${s}`;
}

function pad(str, width) {
  str = String(str);
  return str.length >= width ? str : str + ' '.repeat(width - str.length);
}
// A left-aligned name column that always leaves a trailing gap: names longer
// than the field are clipped with an ellipsis so they never touch the next column.
function col(str, width) {
  str = String(str);
  if (str.length > width - 1) str = str.slice(0, width - 2) + '…';
  return pad(str, width);
}
function padStart(str, width) {
  str = String(str);
  return str.length >= width ? str : ' '.repeat(width - str.length) + str;
}

function pct(part, whole) {
  if (!whole) return '0%';
  return `${Math.round((part / whole) * 100)}%`;
}

function formatPct(rate) {
  return `${(rate * 100).toFixed(1)}%`;
}

const n = (x) => x.toLocaleString('en-US');

// Clip a path from the front, keeping the readable tail (…/parent/file.ext).
function clipPath(p, width) {
  p = String(p);
  return p.length > width ? '…' + p.slice(-(width - 1)) : p;
}

/**
 * Render a human-readable terminal report.
 * @param {object} r aggregate() output
 * @param {object} ctx { root, color }
 */
export function renderText(r, ctx = {}) {
  const c = makeColor(ctx.color !== false);
  const out = [];
  const line = (s = '') => out.push(s);

  line();
  line(`  ${c('bold', 'agentmeter')} ${c('dim', '· agent usage report')}`);
  const meta = [];
  if (ctx.root) meta.push(ctx.root);
  meta.push(`${r.sessions} session${r.sessions === 1 ? '' : 's'}`);
  if (r.sinceMs != null) meta.push(`since ${new Date(r.sinceMs).toISOString().slice(0, 10)}`);
  line(`  ${c('gray', meta.join(' · '))}`);
  line();

  if (!r.messages) {
    line(`  ${c('yellow', 'No agent activity found in range.')}`);
    line(`  ${c('dim', 'Looked under ~/.claude/projects (override with a path argument).')}`);
    line();
    return out.join('\n');
  }

  // --- Totals --------------------------------------------------------------
  line(
    `  ${c('bold', pad('Total cost', 18))}${c('bold', c('green', pad(formatUSD(r.cost.total), 14)))}${c('dim', `${formatTokens(r.tokens.total)} tokens · ${r.messages.toLocaleString('en-US')} messages`)}`
  );
  line(`  ${c('gray', RULE)}`);
  const costRow = (label, val) =>
    line(`  ${c('gray', pad(label, 18))}${pad(formatUSD(val), 14)}${c('dim', pct(val, r.cost.total))}`);
  costRow('input', r.cost.input);
  costRow('output', r.cost.output);
  costRow('cache write', r.cost.cacheWrite);
  costRow('cache read', r.cost.cacheRead);
  line();

  // --- By model ------------------------------------------------------------
  section(line, c, 'By model', r.byModel, r.cost.total, (e) => e.model);

  // --- By project ----------------------------------------------------------
  section(line, c, 'By project', r.byProject, r.cost.total, (e) => e.project);

  // --- Main loop vs subagents ---------------------------------------------
  line(`  ${c('bold', 'Main loop vs subagents')}`);
  line(`  ${c('gray', RULE)}`);
  const lane = (label, l) =>
    line(
      `  ${pad(label, 18)}${pad(formatUSD(l.cost.total), 14)}${c('dim', `${pct(l.cost.total, r.cost.total)} · ${l.messages.toLocaleString('en-US')} msgs`)}`
    );
  lane('main loop', r.subagent.main);
  lane('subagents', r.subagent.sidechain);
  line();

  // --- Attribution: skills / plugins / MCP servers ------------------------
  if (r.bySkill.length) section(line, c, 'Top skills', r.bySkill, r.cost.total, (e) => e.skill);
  if (r.byPlugin.length) section(line, c, 'Top plugins', r.byPlugin, r.cost.total, (e) => e.plugin);
  if (r.byMcpServer.length)
    section(line, c, 'Top MCP servers', r.byMcpServer, r.cost.total, (e) => e.server);

  // --- Tool usage ----------------------------------------------------------
  if (r.byTool.length) {
    line(`  ${c('bold', 'Top tools')} ${c('dim', '(by call count)')}`);
    line(`  ${c('gray', RULE)}`);
    const totalCalls = r.byTool.reduce((s, t) => s + t.calls, 0);
    for (const t of r.byTool.slice(0, TOP_N)) {
      line(`  ${col(t.tool, 32)}${padStart(t.calls.toLocaleString('en-US'), 9)}  ${c('dim', pct(t.calls, totalCalls))}`);
    }
    if (r.byTool.length > TOP_N) line(`  ${c('dim', `… +${r.byTool.length - TOP_N} more`)}`);
    line();
  }

  // --- Efficiency (compact summary) ---------------------------------------
  const e = r.efficiency;
  if (e && (e.results || e.duplicates.total || e.interrupts)) {
    effSummary(line, c, e);
    line(`  ${c('dim', 'run with --efficiency for the breakdown')}`);
    line();
  }

  // --- Notes ---------------------------------------------------------------
  if (r.serverTools.webSearch || r.serverTools.webFetch) {
    line(
      `  ${c('dim', `Server tools (not priced above): ${r.serverTools.webSearch} web searches, ${r.serverTools.webFetch} web fetches`)}`
    );
  }
  if (r.unpriced.messages) {
    const models = Object.keys(r.unpriced.models).join(', ');
    line(`  ${c('yellow', '⚠')} ${c('dim', `${r.unpriced.messages} message(s) on unpriced models (cost shown as $0): ${models}`)}`);
  }
  adviceTip(line, c);
  line();

  return out.join('\n');
}

function section(line, c, title, rows, totalCost, nameOf) {
  line(`  ${c('bold', title)}`);
  line(`  ${c('gray', RULE)}`);
  for (const e of rows.slice(0, TOP_N)) {
    line(
      `  ${col(nameOf(e), 30)}${pad(formatUSD(e.cost.total), 14)}${c('dim', `${pct(e.cost.total, totalCost)} · ${e.messages.toLocaleString('en-US')} msgs`)}`
    );
  }
  if (rows.length > TOP_N) line(`  ${c('dim', `… +${rows.length - TOP_N} more`)}`);
  line();
}

// agentmeter measures; it doesn't advise. Point users at an agent for interpretation.
function adviceTip(line, c) {
  line(`  ${c('dim', 'Want recommendations? Pipe this into an agent to interpret:')}`);
  line(`  ${c('dim', '  agentmeter --json | claude -p "review my agent usage and suggest improvements"')}`);
}

function effSummary(line, c, e) {
  line(`  ${c('bold', 'Efficiency')}`);
  line(`  ${c('gray', RULE)}`);
  const row = (label, val, note) =>
    line(`  ${pad(label, 18)}${pad(n(val), 10)}${c('dim', note)}`);
  line(
    `  ${pad('tool error rate', 18)}${pad(formatPct(e.errors.rate), 10)}${c('dim', `${n(e.errors.total)} / ${n(e.results)} results`)}`
  );
  row('redundant reads', e.duplicates.redundantReads, 'identical file re-reads');
  row('duplicate calls', e.duplicates.total, 'identical tool+input repeats');
  row('rejected calls', e.rejections.total, 'permission prompts denied');
  row('interrupts', e.interrupts, 'turns you cut short');
  line();
}

function countSection(line, c, title, rows, nameKey, unit = '') {
  if (!rows.length) return;
  line(`  ${c('bold', title)}`);
  line(`  ${c('gray', RULE)}`);
  for (const e of rows.slice(0, TOP_N)) {
    line(`  ${col(e[nameKey], 38)}${padStart(n(e.count), 8)}${unit ? c('dim', ` ${unit}`) : ''}`);
  }
  if (rows.length > TOP_N) line(`  ${c('dim', `… +${rows.length - TOP_N} more`)}`);
  line();
}

/**
 * Render the detailed efficiency report (the --efficiency view).
 * @param {object} r aggregate() output
 * @param {object} ctx { root, color }
 */
export function renderEfficiency(r, ctx = {}) {
  const c = makeColor(ctx.color !== false);
  const out = [];
  const line = (s = '') => out.push(s);
  const e = r.efficiency;

  line();
  line(`  ${c('bold', 'agentmeter')} ${c('dim', '· efficiency report')}`);
  const meta = [];
  if (ctx.root) meta.push(ctx.root);
  meta.push(`${r.sessions} session${r.sessions === 1 ? '' : 's'}`);
  if (r.sinceMs != null) meta.push(`since ${new Date(r.sinceMs).toISOString().slice(0, 10)}`);
  line(`  ${c('gray', meta.join(' · '))}`);
  line();

  if (!e || !e.results) {
    line(`  ${c('yellow', 'No tool activity found in range.')}`);
    line();
    return out.join('\n');
  }

  effSummary(line, c, e);
  countSection(line, c, 'Most error-prone tools', e.errors.byTool, 'tool', 'errors');
  countSection(line, c, 'Duplicate calls by tool', e.duplicates.byTool, 'tool', 'repeats');

  if (e.hotFiles.length) {
    line(`  ${c('bold', 'Most re-read files')} ${c('dim', '(candidates to summarize into CLAUDE.md / memory)')}`);
    line(`  ${c('gray', RULE)}`);
    for (const f of e.hotFiles.slice(0, TOP_N)) {
      line(`  ${col(clipPath(f.file, 44), 46)}${padStart(n(f.reads), 6)} ${c('dim', 'reads')}`);
    }
    if (e.hotFiles.length > TOP_N) line(`  ${c('dim', `… +${e.hotFiles.length - TOP_N} more`)}`);
    line();
  }

  countSection(line, c, 'Rejected calls by tool', e.rejections.byTool, 'tool', 'denied');

  adviceTip(line, c);
  line();

  return out.join('\n');
}

const round = (n) => Number(n.toFixed(6));
function roundCost(c) {
  return {
    total: round(c.total),
    input: round(c.input),
    output: round(c.output),
    cacheWrite: round(c.cacheWrite),
    cacheRead: round(c.cacheRead),
  };
}

/**
 * Build a JSON-serializable view of the report.
 * @param {object} r aggregate() output
 * @param {object} ctx { root }
 */
export function toJSON(r, ctx = {}) {
  const mapRows = (rows, nameKey) =>
    rows.map((e) => ({ [nameKey]: e[nameKey], messages: e.messages, cost: roundCost(e.cost) }));
  return {
    root: ctx.root ?? null,
    since: r.sinceMs != null ? new Date(r.sinceMs).toISOString() : null,
    sessions: r.sessions,
    filesScanned: r.filesScanned,
    messages: r.messages,
    firstTimestamp: r.firstTs,
    lastTimestamp: r.lastTs,
    tokens: r.tokens,
    cost: roundCost(r.cost),
    serverTools: r.serverTools,
    subagent: {
      main: { messages: r.subagent.main.messages, cost: roundCost(r.subagent.main.cost) },
      sidechain: { messages: r.subagent.sidechain.messages, cost: roundCost(r.subagent.sidechain.cost) },
    },
    byModel: mapRows(r.byModel, 'model'),
    byProject: mapRows(r.byProject, 'project'),
    byDay: mapRows(r.byDay, 'day'),
    byTool: r.byTool,
    bySkill: mapRows(r.bySkill, 'skill'),
    byPlugin: mapRows(r.byPlugin, 'plugin'),
    byMcpServer: mapRows(r.byMcpServer, 'server'),
    unpriced: r.unpriced,
    efficiency: r.efficiency
      ? {
          results: r.efficiency.results,
          interrupts: r.efficiency.interrupts,
          errors: { ...r.efficiency.errors, rate: round(r.efficiency.errors.rate) },
          rejections: r.efficiency.rejections,
          duplicates: r.efficiency.duplicates,
          hotFiles: r.efficiency.hotFiles.slice(0, 100),
        }
      : null,
  };
}
