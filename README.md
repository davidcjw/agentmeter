# agentmeter

![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)
![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)
![dependencies: none](https://img.shields.io/badge/dependencies-none-brightgreen.svg)
![PRs welcome](https://img.shields.io/badge/PRs-welcome-blue.svg)

**See what your AI coding agent actually costs.**

`agentmeter` reads your local [Claude Code](https://claude.com/claude-code) transcripts and turns them into two reports:

- a **cost report** — by **project, day, model, tool**, and (the part nobody else shows you) **per skill, plugin, and MCP server**, plus a **main-loop vs subagent** split;
- an **efficiency report** (`--efficiency`) — tool **error rate**, **duplicate calls** and **redundant file reads** (loop/retry signal), **most re-read files** (candidates to summarize into `CLAUDE.md`/memory), and **denied permission prompts**.

It runs entirely on your machine. Nothing is uploaded anywhere; it only reads the transcript files Claude Code already writes to `~/.claude/projects`.

Zero runtime dependencies. One Node file's worth of logic, a real test suite, and a `--json` mode for scripts and CI.

<!-- Demo: the sample output below doubles as the demo. To add a recorded clip, capture it with vhs (https://github.com/charmbracelet/vhs) and drop it at docs/demo.gif, then embed it here. -->

## Contents

- [Install](#install)
- [Usage](#usage) · [Efficiency report](#efficiency-report)
- [Getting recommendations](#getting-recommendations)
- [What it reads](#what-it-reads) · [How cost is computed](#how-cost-is-computed)
- [JSON output](#json-output) · [Library use](#library-use)
- [Development](#development) · [Roadmap](#roadmap)
- [Contributing](#contributing) · [Code of Conduct](#code-of-conduct) · [License](#license)

```
  agentmeter · agent usage report
  ~/.claude/projects · 412 sessions

  Total cost        $1,284.50     1820.4M tokens · 38,201 messages
  ────────────────────────────────────────────────────
  input             $42.10        3%
  output            $221.66       17%
  cache write       $498.30       39%
  cache read        $522.44       41%

  By model
  ────────────────────────────────────────────────────
  opus-4-8                      $1,150.20     90% · 26,400 msgs
  sonnet-4-6                    $128.40       10% · 11,200 msgs
  haiku-4-5                     $5.90         0% · 601 msgs

  Main loop vs subagents
  ────────────────────────────────────────────────────
  main loop         $1,210.10     94% · 35,900 msgs
  subagents         $74.40        6% · 2,301 msgs

  Top MCP servers
  ────────────────────────────────────────────────────
  playwright                    $180.22       14% · 1,900 msgs
  context-mode                  $44.10        3% · 820 msgs
  …
```

## Install

```sh
npx agentmeter            # run without installing
# or
npm install -g agentmeter
```

Requires Node ≥ 18.

## Usage

```sh
agentmeter                     # full lifetime cost report
agentmeter --since 7d          # just the last 7 days (also: 24h, 90m, or an ISO date)
agentmeter --efficiency        # where tokens are being wasted (errors, loops, re-reads)
agentmeter --json | jq .cost   # pull the cost breakdown into a script
agentmeter /path/to/projects   # scan a non-default transcript root
```

| Option | Description |
|---|---|
| `[path]` | Transcript root to scan (default `~/.claude/projects`). |
| `-s, --since <window>` | Only count activity within a window: `7d`, `24h`, `90m`, or an ISO date. |
| `-e, --efficiency` | Show the efficiency report instead of cost. |
| `--json` | Emit machine-readable JSON (always includes the `efficiency` block). |
| `--no-color` | Disable ANSI colors. |
| `-h, --help` / `-v, --version` | Help / version. |

### Efficiency report

```
  agentmeter · efficiency report

  Efficiency
  ────────────────────────────────────────────────────
  tool error rate   4.0%      1,189 / 29,770 results
  redundant reads   183       identical file re-reads
  duplicate calls   1,446     identical tool+input repeats
  rejected calls    42        permission prompts denied
  interrupts        93        turns you cut short

  Most re-read files (candidates to summarize into CLAUDE.md / memory)
  ────────────────────────────────────────────────────
  …/src/components/Sidebar.tsx                      81 reads
  …/memory/MEMORY.md                                52 reads
  …
```

`--efficiency` also lists the most error-prone tools, duplicate calls by tool, and which tools' permission prompts you denied. **Duplicate calls** are identical `(tool, input)` repeats within a session — a strong signal for file re-reads, softer for things like re-navigating a browser; treat them as *candidates* to investigate, not proof of waste.

## What it reads

Claude Code writes one JSONL transcript per session under `~/.claude/projects/<encoded-path>/<session>.jsonl`. `agentmeter` reads:

- **`assistant` records** — each carries a `usage` block (`input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens` with the 5m/1h split), the `model`, the `tool_use` calls in that turn (with `id` + `input`), an `isSidechain` flag for subagent work, and Claude Code's `attributionSkill` / `attributionPlugin` / `attributionMcpServer` fields. Those attributions are what make per-skill / per-MCP cost **exact** rather than guessed.
- **`tool_result` blocks** (in the following user records) — used for the efficiency report: `is_error` flags drive the error rate, and the literal "tool use was rejected" content marks a denied permission prompt. Results link back to their tool via `tool_use_id`.

## How cost is computed

Prices are USD per million tokens (the one thing that needs maintenance — kept isolated in [`src/pricing.js`](src/pricing.js)):

| Model | Input | Output |
|---|---|---|
| Opus 4.x | $5 | $25 |
| Sonnet 4.x | $3 | $15 |
| Haiku 4.5 | $1 | $5 |
| Fable 5 | $10 | $50 |

Cache tokens are priced relative to the model's input rate: **cache write 1.25×** (5-minute TTL) / **2×** (1-hour TTL), **cache read 0.1×**. When a record carries the `ephemeral_5m` / `ephemeral_1h` split, each tier is priced exactly; otherwise cache creation is treated as the 5-minute tier.

Models that aren't in the pricing table (e.g. `<synthetic>` local messages) are counted but contribute `$0`, and the report flags how many such messages it saw. Server-tool requests (web search / web fetch) are counted and noted but not yet priced.

> Costs are an estimate from public list prices. They don't reflect subscription plans, discounts, or batch pricing — treat them as a relative guide to *where* your tokens go, not a billing statement.

## JSON output

`--json` emits a stable object: `cost` and `tokens` totals, `subagent` split, `byModel` / `byProject` / `byDay` / `byTool` / `bySkill` / `byPlugin` / `byMcpServer` arrays, an `unpriced` summary, and an `efficiency` block (`errors`, `rejections`, `duplicates`, `hotFiles`, `interrupts`). Good for dashboards, `jq`, or a CI budget check.

## Getting recommendations

`agentmeter` **measures; it doesn't advise.** A 4% error rate or a file read 80 times might be fine or a problem depending entirely on your workflow — so the tool reports the numbers and leaves the judgement to you. The fastest way to turn the report into concrete suggestions is to feed it to an agent:

```sh
agentmeter --json | claude -p "Review my Claude Code usage and suggest concrete improvements"
# or the efficiency view specifically:
agentmeter --efficiency | claude -p "Where am I wasting tokens? Give me 3 actionable fixes"
```

The `--json` output is the richest input (full breakdowns + the `efficiency` block), and any agent — Claude Code, the `claude` CLI, or a chat window you paste into — can interpret it for your situation.

## Library use

```js
import { run, report } from 'agentmeter';

const { result } = run({ since: '30d' });
console.log(result.cost.total);

console.log(report({ json: true })); // rendered string
```

## Development

```sh
npm install
npm test          # vitest, 27 tests
npm run test:watch
```

## Roadmap

- **v0.1** — cost report (by project / day / model / tool / skill / plugin / MCP, main-loop vs subagent). ✅
- **v0.2** (this release) — efficiency report: tool errors, duplicate calls & redundant reads (loop/retry), most re-read files (the grounded stand-in for "dead context" — strict CLAUDE.md-never-read detection isn't reliable from transcripts, since auto-loaded files are injected, not read via a tool), and denied permission prompts. ✅
- **Next** — per-tool token attribution; cost trend / sparkline over time; other transcript formats (Cursor, Codex).

## Contributing

Contributions are welcome! Please open an issue first to discuss what you'd like to change. See [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow.

If you're adding a model or correcting a price, that lives in one place: [`src/pricing.js`](src/pricing.js). Please include a test.

## Code of Conduct

This project follows the [Contributor Covenant v2.1](https://www.contributor-covenant.org/version/2/1/code_of_conduct/). By participating you agree to uphold a welcoming, harassment-free environment. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## License

Distributed under the MIT License — see [LICENSE](LICENSE). MIT © David Chong
