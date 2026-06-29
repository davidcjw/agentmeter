import { describe, it, expect, afterEach } from 'vitest';
import { run } from '../src/index.js';
import { parseSince } from '../src/aggregate.js';
import { makeRoot, asstRecord } from './helpers.js';

let project;
afterEach(() => project?.cleanup());

describe('aggregate', () => {
  it('totals cost and tokens across files and projects', () => {
    project = makeRoot({
      'proj-a': [
        [asstRecord({ input: 1_000_000, output: 0, model: 'claude-opus-4-8' })], // $5
        [asstRecord({ input: 0, output: 1_000_000, model: 'claude-opus-4-8' })], // $25
      ],
      'proj-b': [
        [asstRecord({ input: 1_000_000, output: 0, model: 'claude-sonnet-4-6' })], // $3
      ],
    });
    const { result } = run({ path: project.root });
    expect(result.messages).toBe(3);
    expect(result.sessions).toBe(3);
    expect(result.cost.total).toBeCloseTo(33, 4);
    expect(result.byModel[0].model).toBe('opus-4-8'); // most expensive first
    expect(result.byProject.find((p) => p.project === 'proj-a').cost.total).toBeCloseTo(30, 4);
  });

  it('splits main loop vs subagents', () => {
    project = makeRoot({
      proj: [
        [
          asstRecord({ output: 1_000_000, model: 'claude-opus-4-8' }), // main, $25
          asstRecord({ output: 1_000_000, model: 'claude-opus-4-8', isSidechain: true }), // sub, $25
        ],
      ],
    });
    const { result } = run({ path: project.root });
    expect(result.subagent.main.messages).toBe(1);
    expect(result.subagent.sidechain.messages).toBe(1);
    expect(result.subagent.sidechain.cost.total).toBeCloseTo(25, 4);
  });

  it('attributes cost to skills and counts tool calls', () => {
    project = makeRoot({
      proj: [
        [
          asstRecord({ output: 1_000_000, skill: 'traverse-repo', tools: ['Bash', 'Bash', 'Read'] }),
          asstRecord({ output: 400_000, skill: 'traverse-repo', tools: ['Bash'] }),
        ],
      ],
    });
    const { result } = run({ path: project.root });
    expect(result.bySkill[0].skill).toBe('traverse-repo');
    expect(result.bySkill[0].messages).toBe(2);
    const bash = result.byTool.find((t) => t.tool === 'Bash');
    expect(bash.calls).toBe(3);
  });

  it('flags unpriced models without inflating cost', () => {
    project = makeRoot({
      proj: [[asstRecord({ input: 1_000_000, model: '<synthetic>' })]],
    });
    const { result } = run({ path: project.root });
    expect(result.cost.total).toBe(0);
    expect(result.unpriced.messages).toBe(1);
    expect(result.unpriced.models['<synthetic>']).toBe(1);
  });

  it('filters by --since window', () => {
    const now = Date.parse('2026-06-29T00:00:00.000Z');
    project = makeRoot({
      proj: [
        [
          asstRecord({ output: 1_000_000, timestamp: '2026-06-28T00:00:00.000Z' }), // in 7d
          asstRecord({ output: 1_000_000, timestamp: '2026-06-01T00:00:00.000Z' }), // out
        ],
      ],
    });
    const all = run({ path: project.root, now });
    expect(all.result.messages).toBe(2);
    const recent = run({ path: project.root, since: '7d', now });
    expect(recent.result.messages).toBe(1);
    expect(recent.result.cost.total).toBeCloseTo(25, 4);
  });

  it('throws on a missing transcript root', () => {
    expect(() => run({ path: '/definitely/not/here' })).toThrow(/not found/);
  });
});

describe('parseSince', () => {
  const now = Date.parse('2026-06-29T00:00:00.000Z');
  it('parses relative windows', () => {
    expect(parseSince('7d', now)).toBe(now - 7 * 86_400_000);
    expect(parseSince('24h', now)).toBe(now - 24 * 3_600_000);
    expect(parseSince('90m', now)).toBe(now - 90 * 60_000);
  });
  it('parses an ISO date', () => {
    expect(parseSince('2026-06-01', now)).toBe(Date.parse('2026-06-01'));
  });
  it('returns null for empty input', () => {
    expect(parseSince(undefined, now)).toBeNull();
  });
  it('throws on garbage', () => {
    expect(() => parseSince('lol', now)).toThrow(/invalid --since/);
  });
});
