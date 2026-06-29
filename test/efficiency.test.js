import { describe, it, expect, afterEach } from 'vitest';
import { run } from '../src/index.js';
import { stableStringify, createEfficiencyAccumulator } from '../src/efficiency.js';
import { makeRoot, asstRecord, toolResultRecord, interruptRecord } from './helpers.js';

let project;
afterEach(() => project?.cleanup());

describe('stableStringify', () => {
  it('is key-order independent', () => {
    expect(stableStringify({ a: 1, b: 2 })).toBe(stableStringify({ b: 2, a: 1 }));
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: 2 }));
  });
});

describe('efficiency accumulator', () => {
  it('counts duplicate calls and redundant reads within a session', () => {
    const acc = createEfficiencyAccumulator();
    acc.addSession(
      [
        { id: '1', name: 'Read', input: { file_path: '/a.txt' } },
        { id: '2', name: 'Read', input: { file_path: '/a.txt' } }, // identical -> redundant
        { id: '3', name: 'Bash', input: { command: 'ls' } },
        { id: '4', name: 'Bash', input: { command: 'ls' } }, // identical -> duplicate
        { id: '5', name: 'Read', input: { file_path: '/a.txt', offset: 100 } }, // different range, not redundant
      ],
      [],
      0
    );
    const e = acc.finalize();
    expect(e.duplicates.redundantReads).toBe(1);
    expect(e.duplicates.total).toBe(2); // one Read dup + one Bash dup
    expect(e.hotFiles[0].file).toBe('/a.txt');
    expect(e.hotFiles[0].reads).toBe(3);
  });

  it('attributes errors and rejections to the calling tool', () => {
    const acc = createEfficiencyAccumulator();
    acc.addSession(
      [{ id: 'x', name: 'Bash', input: { command: 'boom' } }],
      [
        { toolUseId: 'x', isError: true, rejected: false },
        { toolUseId: 'x', isError: false, rejected: true },
      ],
      0
    );
    const e = acc.finalize();
    expect(e.results).toBe(2);
    expect(e.errors.total).toBe(1);
    expect(e.errors.byTool[0]).toEqual({ tool: 'Bash', count: 1 });
    expect(e.rejections.total).toBe(1);
    expect(e.errors.rate).toBeCloseTo(0.5, 6);
  });
});

describe('efficiency end-to-end via run()', () => {
  it('surfaces errors, rejections, redundant reads, and interrupts', () => {
    project = makeRoot({
      proj: [
        [
          asstRecord({
            output: 100,
            toolUses: [
              { id: 'a', name: 'Read', input: { file_path: '/x.ts' } },
              { id: 'b', name: 'Read', input: { file_path: '/x.ts' } }, // redundant
              { id: 'c', name: 'Bash', input: { command: 'npm test' } },
            ],
          }),
          toolResultRecord({ toolUseId: 'c', isError: true }),
          toolResultRecord({ toolUseId: 'a' }),
          toolResultRecord({ toolUseId: 'b' }),
          interruptRecord(),
        ],
      ],
    });
    const { result } = run({ path: project.root });
    const e = result.efficiency;
    expect(e.duplicates.redundantReads).toBe(1);
    expect(e.errors.total).toBe(1);
    expect(e.errors.byTool[0].tool).toBe('Bash');
    expect(e.interrupts).toBe(1);
    expect(e.hotFiles.find((f) => f.file === '/x.ts').reads).toBe(2);
  });

  it('detects permission rejections', () => {
    project = makeRoot({
      proj: [
        [
          asstRecord({ output: 50, toolUses: [{ id: 'r', name: 'Bash', input: { command: 'rm -rf /' } }] }),
          toolResultRecord({ toolUseId: 'r', rejected: true }),
        ],
      ],
    });
    const { result } = run({ path: project.root });
    expect(result.efficiency.rejections.total).toBe(1);
    expect(result.efficiency.rejections.byTool[0].tool).toBe('Bash');
  });
});
