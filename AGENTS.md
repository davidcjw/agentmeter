# AGENTS.md

Agent-readable map of `agentmeter`. Read this before changing code.

## What this is

A zero-dependency Node CLI that parses local Claude Code transcripts
(`~/.claude/projects/**/*.jsonl`) into a **cost report** and an **efficiency report**.
ES modules, Node ≥ 18, vitest for tests, `--json` for machine output. No network, no
writes — read-only.

## Layout

```
bin/agentmeter.js   CLI entry: arg parsing, help/version; renders cost OR efficiency OR json.
src/index.js        Public API: run(opts) (discover → aggregate) and report(opts). Re-exports everything.
src/discover.js     Find transcript files under a root; project labelling; mtime helper.
src/parse.js        parseTranscript(file) → { records (assistant usage), toolUses, toolResults, interrupts, cwd, sessionId }.
src/pricing.js      PRICING table + normalizeModel() + costForUsage(). THE maintenance point.
src/efficiency.js   createEfficiencyAccumulator() + stableStringify(). Loop/error/rejection/hot-file detection.
src/aggregate.js    aggregate(files, {sinceMs}) → cost + efficiency report; parseSince() for windows.
src/report.js       renderText() (cost + daily sparkline + cache-hit ratio), renderEfficiency() (detail), toJSON(). Helpers: sparkline(), cacheHitRatio(), dailySeries().
test/               vitest specs + helpers.js (temp roots; asstRecord/toolResultRecord/interruptRecord).
```

Data flow: `discover()` → list of `{file, projectDir}` → `aggregate()` parses each via
`parseTranscript()`, prices usage records with `costForUsage()`, feeds tool events to the
efficiency accumulator, and rolls up → `renderText()` / `renderEfficiency()` / `toJSON()`.
Cost and efficiency share ONE parse pass per file.

## Transcript facts the parser relies on

- Only `type: "assistant"` records have `message.usage`. Every other record type is skipped.
- `usage`: `input_tokens`, `output_tokens`, `cache_read_input_tokens`,
  `cache_creation_input_tokens`, and `cache_creation.{ephemeral_5m,ephemeral_1h}_input_tokens`.
- `message.model` — raw id, may carry a date suffix (e.g. `claude-haiku-4-5-20251001`); `<synthetic>` appears too.
- `isSidechain: true` marks subagent messages.
- `attributionSkill` / `attributionPlugin` / `attributionMcpServer` / `attributionMcpTool`
  are present **only** on assistant records and always co-occur with usage → exact attribution.
- `tool_use` content blocks carry `id`, `name`, and `input` (Read→`file_path`, Bash→`command`, …). `id` links to results.
- `tool_result` blocks live in the following **user** records (`message.content`), carry `tool_use_id` + `is_error`, and a denied permission prompt has the literal content "The user doesn't want to proceed with this tool use. The tool use was rejected".
- A user interrupt is a text block containing "[Request interrupted by user]".
- `cwd` gives the real project path; the project dir name is a lossy encoding (slashes → dashes).

## Conventions

- Keep it zero-dependency (vitest is the only devDependency). No new runtime deps.
- Money is USD; tokens are integers. Costs are floats rounded to 6 dp only at the JSON boundary.
- When a list is truncated in the terminal report (top-N), print a `… +N more` line — never silently cap.
- Pricing/model changes go in `src/pricing.js` only.

## Testing

`npm test` (27 tests). Add tests in the same change for any new behaviour. `test/helpers.js`
builds temp roots with `makeRoot({dir: [[records...]]})` and synthetic records via `asstRecord({...})`.

## Conscious non-goals

- No pricing of server-tool requests (web search/fetch) — counted and noted only.
- Per-tool cost attribution is not done (tool calls are counted; cost lives on the message).
- **Strict dead-context detection is intentionally NOT attempted** — auto-loaded CLAUDE.md/AGENTS.md
  files are injected into the prompt, not read via a tool, so "referenced but never read" isn't
  detectable from transcripts. The "most re-read files" metric is the grounded stand-in.
- "Duplicate calls" are identical `(tool, input)` repeats within a session — strong for reads,
  softer for legit re-navigations; framed as candidates, not proven waste.
- **No recommendations engine — by design.** The tool measures and labels; interpreting the
  numbers is a judgement call left to the user or an agent. Both reports print a tip to pipe
  `--json` into an agent (`adviceTip()` in report.js). Don't add a rules/advice layer without
  an explicit decision to reverse this.
- Only Claude Code transcripts (Cursor/Codex deferred).
