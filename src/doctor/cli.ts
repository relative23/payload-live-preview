#!/usr/bin/env node
/**
 * `pll` CLI — currently one subcommand, `doctor`.
 *
 *   npx pll doctor https://example.com/some-page --admin https://cms.example.com
 *
 * Exit codes:
 *   0 — no error-level findings (warnings are reported and do not fail)
 *   1 — usage error, or the URL could not be fetched
 *   2 — at least one error-level finding
 *
 * `pll-codegen` stays its own binary; it predates this one and consumers have
 * it in their scripts.
 *
 * @module @doctor/cli
 */
import { formatReport, runDoctor, type DoctorFetch } from './index';
import { runMigrate } from '../migrate/runner';

interface ParsedArgs {
  url: string | undefined;
  adminOrigin: string | undefined;
  json: boolean;
  v2: boolean;
  showHelp: boolean;
  unknown: string[];
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    url: undefined,
    adminOrigin: undefined,
    json: false,
    v2: false,
    showHelp: false,
    unknown: [],
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === undefined) continue;
    if (token === '-h' || token === '--help') {
      parsed.showHelp = true;
      continue;
    }
    if (token === '--json') {
      parsed.json = true;
      continue;
    }
    if (token === '--v2') {
      parsed.v2 = true;
      continue;
    }
    if (token === '--admin' || token === '-a') {
      parsed.adminOrigin = argv[i + 1];
      i += 1;
      continue;
    }
    if (token.startsWith('--admin=')) {
      parsed.adminOrigin = token.slice('--admin='.length);
      continue;
    }
    if (token.startsWith('-')) {
      parsed.unknown.push(token);
      continue;
    }
    parsed.url ??= token;
  }
  return parsed;
}

const HELP_TEXT = `pll doctor — audit what a live-preview deployment actually serves

Usage:
  pll doctor <url> [--admin <origin>] [--json] [--v2]
  pll migrate <path> [--write] [--only <id,id>]

The URL is fetched twice: once as an ordinary visitor and once with the
headers the Payload admin's iframe sends. Most findings come from the
difference between the two responses.

Options:
  -a, --admin <origin>  Admin origin the preview is embedded from. Enables the
                        frame-ancestors check to verify the origin is admitted,
                        not merely that a policy exists.
      --json            Emit the report as JSON instead of text
      --v2              Also check the page against the 2.0 readiness table
  -h, --help            Show this help

Exit codes:
  0  no error-level findings
  1  usage error, or the URL could not be fetched
  2  at least one error-level finding

Examples:
  pll doctor https://example.com/
  pll doctor https://example.com/blog/hello --admin https://cms.example.com
`;

/**
 * @param fetchImpl Seam for tests, so the argument and output paths can be
 *   exercised without a server. The bin shim never passes it.
 */
export async function run(argv: readonly string[], fetchImpl?: DoctorFetch): Promise<number> {
  const [subcommand, ...rest] = argv;

  if (subcommand === undefined || subcommand === '-h' || subcommand === '--help') {
    process.stdout.write(HELP_TEXT);
    return subcommand === undefined ? 1 : 0;
  }
  if (subcommand === 'migrate') return runMigrateCommand(rest);
  if (subcommand !== 'doctor') {
    process.stderr.write(`pll: unknown command "${subcommand}". Try \`pll --help\`.\n`);
    return 1;
  }

  const args = parseArgs(rest);
  if (args.showHelp) {
    process.stdout.write(HELP_TEXT);
    return 0;
  }
  if (args.unknown.length > 0) {
    process.stderr.write(`pll doctor: unknown option ${args.unknown.join(', ')}\n`);
    return 1;
  }
  if (args.url === undefined) {
    process.stderr.write('pll doctor: a URL is required. Try `pll doctor --help`.\n');
    return 1;
  }

  let report;
  try {
    report = await runDoctor({
      url: args.url,
      ...(args.adminOrigin !== undefined ? { adminOrigin: args.adminOrigin } : {}),
      ...(args.v2 ? { v2: true } : {}),
      ...(fetchImpl !== undefined ? { fetchImpl } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`pll doctor: could not probe ${args.url}: ${message}\n`);
    return 1;
  }

  process.stdout.write(
    args.json ? `${JSON.stringify(report, undefined, 2)}\n` : formatReport(report),
  );
  return report.errors > 0 ? 2 : 0;
}

async function runMigrateCommand(argv: readonly string[]): Promise<number> {
  let target: string | undefined;
  let write = false;
  let only: string[] | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === undefined) continue;
    if (token === '-h' || token === '--help') {
      process.stdout.write(MIGRATE_HELP);
      return 0;
    }
    if (token === '--write') {
      write = true;
      continue;
    }
    if (token === '--only') {
      only = (argv[i + 1] ?? '').split(',').filter((id) => id.length > 0);
      i += 1;
      continue;
    }
    if (token.startsWith('--only=')) {
      only = token
        .slice('--only='.length)
        .split(',')
        .filter((id) => id.length > 0);
      continue;
    }
    if (token.startsWith('-')) {
      process.stderr.write(`pll migrate: unknown option ${token}\n`);
      return 1;
    }
    target ??= token;
  }
  if (target === undefined) {
    process.stderr.write('pll migrate: a path is required. Try `pll migrate --help`.\n');
    return 1;
  }
  let result;
  try {
    result = await runMigrate(target, { write, ...(only !== undefined ? { only } : {}) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`pll migrate: ${message}\n`);
    return 1;
  }
  for (const file of result.files) {
    if (!file.changed) continue;
    const ids = [...new Set(file.edits.map((edit) => edit.codemod))].join(', ');
    process.stdout.write(`${write ? 'migrated' : 'would migrate'} ${file.file} (${ids})\n`);
  }
  const verb = write ? 'Migrated' : 'Would migrate';
  process.stdout.write(`\n${verb} ${String(result.changedCount)} file(s).`);
  process.stdout.write(write ? '\n' : ' Re-run with --write to apply.\n');
  const conflicted = result.files.filter((file) => file.conflicts.length > 0);
  if (conflicted.length > 0) {
    process.stdout.write(`\n${String(conflicted.length)} file(s) need manual attention:\n`);
    for (const file of conflicted) {
      for (const conflict of file.conflicts) {
        process.stdout.write(`  ${file.file}: ${conflict.reason}\n`);
      }
    }
    return 1;
  }
  return 0;
}

const MIGRATE_HELP = `pll migrate — rewrite 1.x APIs to their 2.0 names and homes (ADR 0007)

Usage:
  pll migrate <path> [--write] [--only <id,id>]

Without --write the run only reports what it would change. Codemods touch
only imports from payload-live-preview and the names they bind.

Options:
      --write           Apply the changes (otherwise dry-run)
      --only <ids>      Run only these codemods (comma-separated)
  -h, --help            Show this help
`;

/**
 * Whether this module was run as a program rather than imported.
 *
 * Matches the entry's basename, not the whole path: `includes('pll')` against
 * the full path would auto-run the CLI on import for any project whose
 * directory happens to contain those three letters.
 */
export function isCliInvocation(argv: readonly (string | undefined)[] = process.argv): boolean {
  if (typeof process === 'undefined') return false;
  const entry = argv[1];
  if (entry === undefined || entry === '') return false;
  const name = entry.split(/[\\/]/u).pop() ?? '';
  return name === 'pll' || name === 'pll.cmd' || name.startsWith('doctor-cli');
}

if (isCliInvocation()) {
  // Direct invocation via the bin shim — run and exit with the code.
  void run(process.argv.slice(2)).then((code) => {
    process.exit(code);
  });
}
