#!/usr/bin/env node
/**
 * The `pll` binary: `pll doctor <url>` here, `pll migrate <path>` in
 * migrate/cli. Doctor exit codes: 0 no error-level findings, 1 usage error or
 * the URL could not be fetched, 2 at least one error-level finding.
 */
import { runMigrateCommand } from '../migrate/cli';
import { formatReport } from './format';
import { describeFailure, runDoctor, type DoctorFetch } from './probe';

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
    if (token === '-h' || token === '--help') parsed.showHelp = true;
    else if (token === '--json') parsed.json = true;
    else if (token === '--v2') parsed.v2 = true;
    else if (token === '--admin' || token === '-a') {
      parsed.adminOrigin = argv[i + 1];
      i += 1;
    } else if (token.startsWith('--admin=')) parsed.adminOrigin = token.slice('--admin='.length);
    else if (token.startsWith('-')) parsed.unknown.push(token);
    else parsed.url ??= token;
  }
  return parsed;
}

const HELP_TEXT = `pll doctor — audit what a live-preview deployment actually serves

Usage:
  pll doctor <url> [--admin <origin>] [--json] [--v2]
  pll migrate <path> [--write] [--only <id,id>]

The URL is fetched twice: once as an ordinary visitor and once with the
headers the Payload admin's iframe sends. Most findings come from the
difference between the two responses. Redirects are reported, not followed.

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

function isAbsoluteUrl(value: string): boolean {
  try {
    return new URL(value).origin !== 'null';
  } catch {
    return false;
  }
}

/** @param fetchImpl Seam for tests; the bin shim never passes it. */
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
  if (args.adminOrigin !== undefined && !isAbsoluteUrl(args.adminOrigin)) {
    process.stderr.write(
      `pll doctor: --admin must be an absolute URL such as https://cms.example.com (got "${args.adminOrigin}")\n`,
    );
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
    const message = describeFailure(error);
    if (args.json) {
      process.stdout.write(`${JSON.stringify({ url: args.url, error: message }, undefined, 2)}\n`);
    } else {
      process.stderr.write(`pll doctor: could not probe ${args.url}: ${message}\n`);
    }
    return 1;
  }
  process.stdout.write(
    args.json ? `${JSON.stringify(report, undefined, 2)}\n` : formatReport(report),
  );
  return report.errors > 0 ? 2 : 0;
}

/** Matches the entry's basename only, so importing this module from a path containing `pll` never runs it. */
export function isCliInvocation(argv: readonly (string | undefined)[] = process.argv): boolean {
  if (typeof process === 'undefined') return false;
  const entry = argv[1];
  if (entry === undefined || entry === '') return false;
  const name = entry.split(/[\\/]/u).pop() ?? '';
  return name === 'pll' || name === 'pll.cmd' || name.startsWith('doctor-cli');
}

if (isCliInvocation()) {
  void run(process.argv.slice(2)).then((code) => {
    process.exit(code);
  });
}
