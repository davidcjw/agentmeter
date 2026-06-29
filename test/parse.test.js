import { describe, it, expect, afterEach } from 'vitest';
import { parseTranscript } from '../src/parse.js';
import { discover } from '../src/discover.js';
import { makeRoot, asstRecord, noiseRecord } from './helpers.js';

let project;
afterEach(() => project?.cleanup());

function singleFile(records) {
  project = makeRoot({ proj: [records] });
  const [{ file }] = discover(project.root);
  return parseTranscript(file);
}

describe('parseTranscript', () => {
  it('extracts only assistant records with usage, skipping noise', () => {
    const { records } = singleFile([
      noiseRecord('user'),
      noiseRecord('attachment'),
      asstRecord({ input: 10, output: 5 }),
      asstRecord({ input: 20, output: 8 }),
    ]);
    expect(records).toHaveLength(2);
    expect(records[0].usage.input_tokens).toBe(10);
  });

  it('captures cwd, sessionId, tools, attribution, and isSidechain', () => {
    const { records, cwd, sessionId } = singleFile([
      asstRecord({
        cwd: '/Users/me/code/app',
        sessionId: 'abc',
        tools: ['Bash', 'Read'],
        skill: 'frontend-design',
        plugin: 'frontend',
        mcpServer: 'playwright',
        isSidechain: true,
      }),
    ]);
    expect(cwd).toBe('/Users/me/code/app');
    expect(sessionId).toBe('abc');
    expect(records[0].tools).toEqual(['Bash', 'Read']);
    expect(records[0].attribution.skill).toBe('frontend-design');
    expect(records[0].attribution.mcpServer).toBe('playwright');
    expect(records[0].isSidechain).toBe(true);
  });

  it('returns empty for a missing file', () => {
    expect(parseTranscript('/nope/missing.jsonl').records).toEqual([]);
  });
});
