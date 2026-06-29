import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { makeRoot, asstRecord } from './helpers.js';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'agentmeter.js');

function cli(args = []) {
  try {
    const stdout = execFileSync('node', [BIN, ...args], {
      encoding: 'utf8',
      env: { ...process.env, NO_COLOR: '1' },
    });
    return { code: 0, stdout };
  } catch (err) {
    return { code: err.status ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

let project;
afterEach(() => project?.cleanup());

describe('cli', () => {
  it('prints help and exits 0', () => {
    const { code, stdout } = cli(['--help']);
    expect(code).toBe(0);
    expect(stdout).toContain('USAGE');
    expect(stdout).toContain('agentmeter');
  });

  it('prints a version and exits 0', () => {
    const { code, stdout } = cli(['--version']);
    expect(code).toBe(0);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('errors on unknown options with exit 2', () => {
    const { code, stderr } = cli(['--nope']);
    expect(code).toBe(2);
    expect(stderr).toContain('unknown option');
  });

  it('scans a transcript root and reports cost', () => {
    project = makeRoot({
      proj: [[asstRecord({ output: 1_000_000, model: 'claude-opus-4-8' })]],
    });
    const { code, stdout } = cli([project.root]);
    expect(code).toBe(0);
    expect(stdout).toContain('Total cost');
    expect(stdout).toContain('By model');
    expect(stdout).toContain('$25.00');
  });

  it('emits valid JSON with --json', () => {
    project = makeRoot({
      proj: [[asstRecord({ output: 1_000_000, model: 'claude-opus-4-8' })]],
    });
    const { code, stdout } = cli([project.root, '--json']);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.cost.total).toBeCloseTo(25, 2);
    expect(parsed.byModel[0].model).toBe('opus-4-8');
  });

  it('exits 1 on a missing transcript root', () => {
    const { code, stderr } = cli(['/definitely/not/here']);
    expect(code).toBe(1);
    expect(stderr).toContain('not found');
  });
});
