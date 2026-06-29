import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Build a temp transcript root.
 * @param {Record<string, Array<Array<object>>>} projects
 *   map of projectDir name -> array of session files, each an array of records
 * @returns {{ root: string, cleanup: () => void }}
 */
export function makeRoot(projects) {
  const root = mkdtempSync(join(tmpdir(), 'agentmeter-'));
  let n = 0;
  for (const [dir, files] of Object.entries(projects)) {
    const projDir = join(root, dir);
    mkdirSync(projDir, { recursive: true });
    for (const records of files) {
      const body = records.map((r) => JSON.stringify(r)).join('\n') + '\n';
      writeFileSync(join(projDir, `session-${n++}.jsonl`), body);
    }
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/**
 * Build an assistant record with a usage block.
 * @param {object} o options
 */
export function asstRecord(o = {}) {
  const usage = {
    input_tokens: o.input ?? 0,
    output_tokens: o.output ?? 0,
    cache_read_input_tokens: o.cacheRead ?? 0,
    cache_creation_input_tokens: o.cacheCreation ?? 0,
    ...(o.cacheCreationSplit ? { cache_creation: o.cacheCreationSplit } : {}),
    ...(o.serverToolUse ? { server_tool_use: o.serverToolUse } : {}),
  };
  const content = [];
  if (o.text) content.push({ type: 'text', text: o.text });
  for (const name of o.tools || []) content.push({ type: 'tool_use', name, input: {} });
  // Detailed tool calls with explicit id + input (for efficiency tests).
  let i = 0;
  for (const tu of o.toolUses || []) {
    content.push({ type: 'tool_use', id: tu.id || `toolu_${i++}`, name: tu.name, input: tu.input || {} });
  }

  const rec = {
    type: 'assistant',
    timestamp: o.timestamp || '2026-06-20T10:00:00.000Z',
    message: {
      model: o.model || 'claude-opus-4-8',
      content,
      usage,
    },
  };
  if (o.cwd) rec.cwd = o.cwd;
  if (o.sessionId) rec.sessionId = o.sessionId;
  if (o.isSidechain) rec.isSidechain = true;
  if (o.skill) rec.attributionSkill = o.skill;
  if (o.plugin) rec.attributionPlugin = o.plugin;
  if (o.mcpServer) rec.attributionMcpServer = o.mcpServer;
  if (o.mcpTool) rec.attributionMcpTool = o.mcpTool;
  return rec;
}

/** A non-assistant record (should be ignored by the parser). */
export function noiseRecord(type = 'user') {
  return { type, timestamp: '2026-06-20T10:00:00.000Z', message: { content: 'hello' } };
}

const REJECT_TEXT = 'The user doesn\'t want to proceed with this tool use. The tool use was rejected.';

/** A user record carrying a tool_result block. */
export function toolResultRecord(o = {}) {
  return {
    type: 'user',
    timestamp: o.timestamp || '2026-06-20T10:00:00.000Z',
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: o.toolUseId || 'toolu_0',
          is_error: Boolean(o.isError),
          content: o.rejected ? REJECT_TEXT : o.content || 'ok',
        },
      ],
    },
  };
}

/** A user record representing an interrupt. */
export function interruptRecord(timestamp = '2026-06-20T10:00:00.000Z') {
  return {
    type: 'user',
    timestamp,
    message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] },
  };
}
