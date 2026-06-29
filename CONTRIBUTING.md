# Contributing to agentmeter

Thanks for your interest! Contributions are welcome.

## Ground rules

- **Zero runtime dependencies.** `agentmeter` ships with no production deps (only `vitest` for tests). Please don't add any.
- **Tests for new behaviour.** Anything that changes parsing, pricing, aggregation, or the report should come with a vitest spec in the same PR.
- **Read-only and local.** The tool only reads `~/.claude/projects` transcripts. It must never write, upload, or phone home.

## Workflow

1. Fork the repo and clone your fork.
2. Create a feature branch (`git checkout -b feature/your-feature`).
3. `npm install`, make your change, and `npm test` (all tests must pass).
4. Commit with a clear message (`git commit -m 'feat: describe change'`).
5. Push and open a pull request describing what changed and why.

## Common changes

- **Model prices / cache multipliers** — `src/pricing.js` is the single source of truth. Update the `PRICING` table or `CACHE_*` constants and add/adjust a test in `test/pricing.test.js`.
- **What's pulled from transcripts** — `src/parse.js` (`parseTranscript`). If you rely on a new record field, document it in `AGENTS.md` under the transcript-facts section.
- **New report metric** — add the rollup in `src/aggregate.js` / `src/efficiency.js` and render it in `src/report.js`.

See [`CODEBASE.md`](CODEBASE.md) for a map of the codebase and [`AGENTS.md`](AGENTS.md) for the transcript data contract and conventions.

## Code style

Match the surrounding code: ES modules, `node:`-prefixed builtins, small focused functions, and a `… +N more` line wherever a list is truncated (never silently cap).
