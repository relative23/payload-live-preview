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

interface ParsedArgs {
  url: string | undefined;
  adminOrigin: string | undefined;
  json: boolean;
  showHelp: boolean;
  unknown: string[];
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    url: undefined,
    adminOrigin: undefined,
    json: false,
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
  pll doctor <url> [--admin <origin>] [--json]

The URL is fetched twice: once as an ordinary visitor and once with the
headers the Payload admin's iframe sends. Most findings come from the
difference between the two responses.

Options:
  -a, --admin <origin>  Admin origin the preview is embedded from. Enables the
                        frame-ancestors check to verify the origin is admitted,
                        not merely that a policy exists.
      --json            Emit the report as JSON instead of text
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
