// Build a synthetic ~/.claude/projects-style transcript root for the agentmeter demo GIF.
// Modest, believable numbers — no real spend or private project names.
import { asstRecord, toolResultRecord, noiseRecord } from '../test/helpers.js';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const ROOT = join(homedir(), 'agent-demo-projects');
rmSync(ROOT, { recursive: true, force: true });

const projects = ['payments-api', 'acme-dashboard', 'mobile-app', 'blog-engine'];
const models = ['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001', 'claude-fable-5'];
const tools = ['Edit', 'Bash', 'Read', 'Grep', 'Write', 'TaskCreate'];
const skills = ['frontend-design', 'code-review', 'traverse-repo'];
const mcps = ['github', 'supabase', 'playwright'];

// Deterministic pseudo-random so re-runs are stable-ish (no Math.random dependence on entropy).
let seed = 42;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const between = (lo, hi) => Math.floor(lo + rnd() * (hi - lo));

const now = Date.now();
const DAY = 86_400_000;
const files = {}; // projectDir -> array of session record-arrays

function enc(p) { return '-home-dev-' + p; } // encoded dir name (cwd drives the label anyway)

for (let d = 13; d >= 0; d--) {
  const dayBase = now - d * DAY;
  const sessionsToday = between(1, 4);
  for (let s = 0; s < sessionsToday; s++) {
    const proj = pick(projects);
    const cwd = `/home/dev/${proj}`;
    const dir = enc(proj);
    files[dir] ||= [];
    const records = [];
    const turns = between(3, 9);
    for (let t = 0; t < turns; t++) {
      const ts = new Date(dayBase + between(0, 6) * 3_600_000 + t * 60_000).toISOString();
      // Opus-heavy but with a realistic model mix; cache-read dominates input like real usage.
      const model = rnd() < 0.7 ? 'claude-opus-4-8' : pick(models);
      const o = {
        timestamp: ts, model, cwd, sessionId: `${proj}-${d}-${s}`,
        input: between(200, 1200),
        output: between(300, 2500),
        cacheRead: between(20000, 120000),
        cacheCreation: between(1000, 9000),
        text: 'working on it',
        toolUses: [{ id: `toolu_${t}`, name: pick(tools), input: {} }],
      };
      if (rnd() < 0.25) o.skill = pick(skills);
      if (rnd() < 0.2) { o.mcpServer = pick(mcps); o.mcpTool = 'call'; }
      if (rnd() < 0.15) o.isSidechain = true; // subagent turns
      records.push(asstRecord(o));
      // occasional tool result + noise
      if (rnd() < 0.5) records.push(toolResultRecord({ toolUseId: `toolu_${t}`, timestamp: ts, isError: rnd() < 0.1 }));
    }
    files[dir].push(records);
  }
}

let n = 0;
for (const [dir, sessions] of Object.entries(files)) {
  const pd = join(ROOT, dir);
  mkdirSync(pd, { recursive: true });
  for (const recs of sessions) {
    writeFileSync(join(pd, `session-${n++}.jsonl`), recs.map((r) => JSON.stringify(r)).join('\n') + '\n');
  }
}
console.log('built', ROOT, '·', n, 'sessions across', Object.keys(files).length, 'projects');
