import { homedir } from 'node:os';
import { join, basename } from 'node:path';
import { readdirSync, statSync, existsSync } from 'node:fs';

/**
 * Default transcript root: ~/.claude/projects. Each immediate subdirectory is
 * one project; each *.jsonl inside it is one session transcript.
 * @param {string} [home] override home dir (for testing)
 */
export function defaultRoot(home) {
  return join(home || homedir(), '.claude', 'projects');
}

/**
 * Find all transcript files under a root.
 *
 * @param {string} root the projects directory
 * @returns {Array<{ file: string, projectDir: string }>}
 *   projectDir is the immediate subdirectory name (the encoded project path).
 */
export function discover(root) {
  if (!existsSync(root)) {
    throw new Error(`transcript directory not found: ${root}`);
  }
  const out = [];
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch (err) {
    throw new Error(`cannot read ${root}: ${err.message}`);
  }
  for (const ent of entries) {
    const full = join(root, ent.name);
    if (ent.isDirectory()) {
      walk(full, ent.name, out);
    } else if (ent.isFile() && ent.name.endsWith('.jsonl')) {
      out.push({ file: full, projectDir: '(root)' });
    }
  }
  return out;
}

function walk(dir, projectDir, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) {
      walk(full, projectDir, out);
    } else if (ent.isFile() && ent.name.endsWith('.jsonl')) {
      out.push({ file: full, projectDir });
    }
  }
}

/**
 * Best-effort human label for a project, given the encoded directory name and
 * the `cwd` seen in the transcript. cwd is exact when present; the encoded dir
 * name is lossy (it replaced every "/" with "-") so we only basename it.
 * @param {string} projectDir encoded directory name
 * @param {string|null} cwd working directory captured from a record
 */
export function projectLabel(projectDir, cwd) {
  if (cwd) return basename(cwd) || cwd;
  if (!projectDir || projectDir === '(root)') return projectDir || '(root)';
  // Claude encodes an absolute project path by replacing "/" with "-", so the
  // name starts with "-". For those, the trailing segment is the best label.
  // Anything else is an ordinary dir name — use it verbatim.
  if (!projectDir.startsWith('-')) return projectDir;
  const parts = projectDir.split('-').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : projectDir;
}

/** Resolve a file's mtime in ms, or 0 if it can't be stat'd. */
export function mtimeMs(file) {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}
