#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { run } from '../src/index.js';
import { renderText, renderEfficiency, toJSON } from '../src/report.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function pkgVersion() {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));
    return pkg.version;
  } catch {
    return '0.0.0';
  }
}

const HELP = `
agentmeter — see what your AI coding agent actually costs.

Parses local Claude Code transcripts (~/.claude/projects) into a token/cost
report: by project, day, model, tool, and per skill/plugin/MCP server, plus a
main-loop vs subagent split.

USAGE
  agentmeter [path] [options]

ARGUMENTS
  path                  transcript root to scan (default: ~/.claude/projects)

OPTIONS
  -s, --since <window>  only count activity within a window: 7d, 24h, 90m,
                        or an ISO date (e.g. 2026-06-01)
  -e, --efficiency      show the efficiency report instead of cost: errors,
                        duplicate calls, re-read files, denied permissions
      --json            emit machine-readable JSON (always includes efficiency)
      --no-color        disable ANSI colors
  -h, --help            show this help
  -v, --version         show version

EXAMPLES
  agentmeter                     full lifetime cost report
  agentmeter --since 7d          just the last 7 days
  agentmeter --efficiency        where tokens are being wasted (loops, errors)
  agentmeter --json | jq .cost   pull the cost breakdown into a script
  agentmeter --since 30d --json  monthly usage, machine-readable
`;

function parseArgs(argv) {
  const opts = {
    path: undefined,
    since: undefined,
    efficiency: false,
    json: false,
    color: undefined,
    help: false,
    version: false,
  };
  const errors = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '-s':
      case '--since':
        opts.since = argv[++i];
        if (opts.since === undefined) errors.push('--since expects a value');
        break;
      case '-e':
      case '--efficiency':
        opts.efficiency = true;
        break;
      case '--json':
        opts.json = true;
        break;
      case '--no-color':
        opts.color = false;
        break;
      case '-h':
      case '--help':
        opts.help = true;
        break;
      case '-v':
      case '--version':
        opts.version = true;
        break;
      default:
        if (arg.startsWith('-')) {
          errors.push(`unknown option: ${arg}`);
        } else if (opts.path === undefined) {
          opts.path = arg;
        } else {
          errors.push(`unexpected argument: ${arg}`);
        }
    }
  }
  return { opts, errors };
}

function main() {
  const { opts, errors } = parseArgs(process.argv.slice(2));

  if (opts.help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (opts.version) {
    process.stdout.write(`${pkgVersion()}\n`);
    return 0;
  }
  if (errors.length) {
    process.stderr.write(`agentmeter: ${errors.join('; ')}\n`);
    process.stderr.write(`Try 'agentmeter --help'.\n`);
    return 2;
  }

  const color =
    opts.color !== undefined
      ? opts.color
      : Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;

  let scan;
  try {
    scan = run(opts);
  } catch (err) {
    process.stderr.write(`agentmeter: ${err.message}\n`);
    return 1;
  }

  if (opts.json) {
    process.stdout.write(`${JSON.stringify(toJSON(scan.result, { root: scan.root }), null, 2)}\n`);
  } else if (opts.efficiency) {
    process.stdout.write(`${renderEfficiency(scan.result, { root: scan.root, color })}\n`);
  } else {
    process.stdout.write(`${renderText(scan.result, { root: scan.root, color })}\n`);
  }
  return 0;
}

process.exit(main());
