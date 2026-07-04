import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultRoot, discover, projectLabel, mtimeMs } from '../src/discover.js';

let dir;
afterEach(() => {
  dir?.cleanup();
  dir = undefined;
});

function makeTmpDir() {
  const root = mkdtempSync(join(tmpdir(), 'agentmeter-discover-'));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

describe('defaultRoot', () => {
  it('joins the given home dir with .claude/projects', () => {
    expect(defaultRoot('/home/alice')).toBe(join('/home/alice', '.claude', 'projects'));
  });

  it('falls back to os homedir when none is given', () => {
    expect(defaultRoot()).toContain(join('.claude', 'projects'));
  });
});

describe('discover — project scoping / path encoding', () => {
  it('scopes files to their immediate subdirectory as the encoded project name', () => {
    dir = makeTmpDir();
    const encoded = '-Users-alice-code-myproj';
    mkdirSync(join(dir.root, encoded), { recursive: true });
    writeFileSync(join(dir.root, encoded, 'session-0.jsonl'), '{}\n');

    const files = discover(dir.root);
    expect(files).toHaveLength(1);
    expect(files[0].projectDir).toBe(encoded);
    expect(files[0].file).toBe(join(dir.root, encoded, 'session-0.jsonl'));
  });

  it('recurses into nested subdirectories but keeps the top-level dir as the projectDir', () => {
    dir = makeTmpDir();
    const encoded = '-Users-alice-code-myproj';
    const nested = join(dir.root, encoded, 'nested', 'deeper');
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, 'session-1.jsonl'), '{}\n');

    const files = discover(dir.root);
    expect(files).toHaveLength(1);
    expect(files[0].projectDir).toBe(encoded);
  });

  it('scopes multiple project directories independently', () => {
    dir = makeTmpDir();
    mkdirSync(join(dir.root, 'projA'), { recursive: true });
    mkdirSync(join(dir.root, 'projB'), { recursive: true });
    writeFileSync(join(dir.root, 'projA', 's0.jsonl'), '{}\n');
    writeFileSync(join(dir.root, 'projB', 's0.jsonl'), '{}\n');
    writeFileSync(join(dir.root, 'projB', 's1.jsonl'), '{}\n');

    const files = discover(dir.root);
    const byProject = files.reduce((m, f) => {
      (m[f.projectDir] ||= []).push(f);
      return m;
    }, {});
    expect(byProject.projA).toHaveLength(1);
    expect(byProject.projB).toHaveLength(2);
  });

  it('treats a .jsonl file directly under root as project "(root)"', () => {
    dir = makeTmpDir();
    writeFileSync(join(dir.root, 'loose.jsonl'), '{}\n');

    const files = discover(dir.root);
    expect(files).toHaveLength(1);
    expect(files[0].projectDir).toBe('(root)');
  });

  it('ignores non-.jsonl files', () => {
    dir = makeTmpDir();
    mkdirSync(join(dir.root, 'proj'), { recursive: true });
    writeFileSync(join(dir.root, 'proj', 'session-0.jsonl'), '{}\n');
    writeFileSync(join(dir.root, 'proj', 'notes.txt'), 'hello\n');
    writeFileSync(join(dir.root, 'README.md'), 'hello\n');

    const files = discover(dir.root);
    expect(files).toHaveLength(1);
    expect(files[0].file.endsWith('session-0.jsonl')).toBe(true);
  });

  it('throws when the root directory does not exist', () => {
    expect(() => discover('/definitely/not/a/real/path')).toThrow(/transcript directory not found/);
  });

  it('returns an empty array for an existing but empty root', () => {
    dir = makeTmpDir();
    expect(discover(dir.root)).toEqual([]);
  });
});

describe('projectLabel', () => {
  it('decodes a "-"-joined absolute path to its trailing segment', () => {
    expect(projectLabel('-Users-alice-code-myproj', null)).toBe('myproj');
  });

  it('prefers the cwd basename when a cwd is provided', () => {
    expect(projectLabel('-Users-alice-code-myproj', '/Users/alice/code/myproj')).toBe('myproj');
  });

  it('returns an ordinary (non-encoded) directory name verbatim', () => {
    expect(projectLabel('myproj', null)).toBe('myproj');
  });

  it('returns "(root)" for the root pseudo-project', () => {
    expect(projectLabel('(root)', null)).toBe('(root)');
  });
});

describe('mtimeMs', () => {
  it('returns the mtime in ms for an existing file', () => {
    dir = makeTmpDir();
    const file = join(dir.root, 'f.jsonl');
    writeFileSync(file, '{}\n');
    const when = new Date('2026-01-15T00:00:00.000Z');
    utimesSync(file, when, when);
    expect(mtimeMs(file)).toBe(when.getTime());
  });

  it('returns 0 for a file that cannot be stat\'d', () => {
    expect(mtimeMs('/definitely/not/a/real/file.jsonl')).toBe(0);
  });
});

describe('--since style filtering via mtimeMs', () => {
  // discover() returns every transcript file; callers filter by mtime for --since.
  // Exercise that filtering here against the mtimeMs() building block.
  function setMtime(file, isoDate) {
    const when = new Date(isoDate);
    utimesSync(file, when, when);
  }

  it('excludes files older than the cutoff, includes newer, includes the exact boundary', () => {
    dir = makeTmpDir();
    mkdirSync(join(dir.root, 'proj'), { recursive: true });

    const older = join(dir.root, 'proj', 'older.jsonl');
    const boundary = join(dir.root, 'proj', 'boundary.jsonl');
    const newer = join(dir.root, 'proj', 'newer.jsonl');
    writeFileSync(older, '{}\n');
    writeFileSync(boundary, '{}\n');
    writeFileSync(newer, '{}\n');

    setMtime(older, '2026-01-01T00:00:00.000Z');
    const cutoffIso = '2026-01-10T00:00:00.000Z';
    setMtime(boundary, cutoffIso);
    setMtime(newer, '2026-01-20T00:00:00.000Z');

    const cutoffMs = new Date(cutoffIso).getTime();
    const files = discover(dir.root);
    const inWindow = files.filter((f) => mtimeMs(f.file) >= cutoffMs);
    const names = inWindow.map((f) => f.file.split('/').pop()).sort();

    expect(names).toEqual(['boundary.jsonl', 'newer.jsonl']);
  });
});
