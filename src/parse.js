import { readFileSync } from 'node:fs';

// A denied permission prompt is recorded as a tool_result with this content.
const REJECT_RE = /the user doesn't want to proceed with this tool use|tool use was rejected/i;

function contentText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((b) => (b && typeof b.text === 'string' ? b.text : '')).join(' ');
  }
  return '';
}

/**
 * Parse one transcript file. Pulls three things out of the JSONL:
 *   - assistant usage records (for the cost report)
 *   - tool_use blocks (id/name/input — for loop & duplicate detection)
 *   - tool_result blocks (errors and permission denials)
 * plus a count of user interrupts.
 *
 * Non-relevant lines are fast-skipped before JSON.parse.
 *
 * @param {string} file absolute path to a *.jsonl transcript
 * @returns {{
 *   records: Array<object>,
 *   toolUses: Array<{id: string|null, name: string, input: object, isSidechain: boolean, ts: string|null}>,
 *   toolResults: Array<{toolUseId: string|null, isError: boolean, rejected: boolean, ts: string|null}>,
 *   interrupts: Array<string|null>,
 *   cwd: string|null,
 *   sessionId: string|null,
 * }}
 */
export function parseTranscript(file) {
  let data;
  try {
    data = readFileSync(file, 'utf8');
  } catch {
    return { records: [], toolUses: [], toolResults: [], interrupts: [], cwd: null, sessionId: null };
  }

  const records = [];
  const toolUses = [];
  const toolResults = [];
  const interrupts = [];
  let cwd = null;
  let sessionId = null;

  for (const line of data.split('\n')) {
    if (!line) continue;
    // Cheap pre-filter: keep assistant usage (input_tokens), tool results, and interrupts.
    if (
      !line.includes('input_tokens') &&
      !line.includes('tool_result') &&
      !line.includes('Request interrupted')
    ) {
      continue;
    }

    let r;
    try {
      r = JSON.parse(line);
    } catch {
      continue;
    }

    if (!cwd && r.cwd) cwd = r.cwd;
    if (!sessionId && r.sessionId) sessionId = r.sessionId;
    const ts = r.timestamp || null;
    const content = r.message && r.message.content;

    if (r.type === 'assistant') {
      const usage = r.message && r.message.usage;
      if (!usage) continue;

      const tools = [];
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block && block.type === 'tool_use' && block.name) {
            tools.push(block.name);
            toolUses.push({
              id: block.id || null,
              name: block.name,
              input: block.input && typeof block.input === 'object' ? block.input : {},
              isSidechain: Boolean(r.isSidechain),
              ts,
            });
          }
        }
      }

      records.push({
        model: r.message.model || null,
        usage,
        isSidechain: Boolean(r.isSidechain),
        timestamp: ts,
        tools,
        attribution: {
          skill: r.attributionSkill || null,
          plugin: r.attributionPlugin || null,
          mcpServer: r.attributionMcpServer || null,
          mcpTool: r.attributionMcpTool || null,
        },
        webSearch: (usage.server_tool_use && usage.server_tool_use.web_search_requests) || 0,
        webFetch: (usage.server_tool_use && usage.server_tool_use.web_fetch_requests) || 0,
      });
    } else if (Array.isArray(content)) {
      // user (or other) record: collect tool_result blocks + interrupts
      for (const block of content) {
        if (!block) continue;
        if (block.type === 'tool_result') {
          const txt = contentText(block.content);
          toolResults.push({
            toolUseId: block.tool_use_id || null,
            isError: Boolean(block.is_error),
            rejected: REJECT_RE.test(txt),
            ts,
          });
        } else if (block.type === 'text' && typeof block.text === 'string' && block.text.includes('Request interrupted')) {
          interrupts.push(ts);
        }
      }
    } else if (typeof content === 'string' && content.includes('Request interrupted')) {
      interrupts.push(ts);
    }
  }

  return { records, toolUses, toolResults, interrupts, cwd, sessionId };
}
