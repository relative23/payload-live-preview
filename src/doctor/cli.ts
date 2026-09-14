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
  /** Headers for the preview probe, from every `--header`/`-H`. */
  headers: Record<string, string>;
  /** Set when a `--header` value is missing or not `Name: value`. */
  badHeader: boolean;
}

/** An HTTP field name (RFC 9110 token), a colon, then the value. */
const HEADER_LINE = /^([!#$%&'*+.^_`|~0-9A-Za-z-]+):[ \t]*(.*)$/u;

function addHeader(parsed: ParsedArgs, line: string | undefined): void {
  const match = line === undefined ? null : HEADER_LINE.exec(line);
  const name = match?.[1];
  const value = match?.[2];
  if (name === undefined || value === undefined) {
    parsed.badHeader = true;
    return;
  }
  parsed.headers[name] = value;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    url: undefined,
    adminOrigin: undefined,
    json: false,
    v2: false,
    showHelp: false,
    unknown: [],
    headers: {},
    badHeader: false,
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
    else if (token === '--header' || token === '-H') {
      addHeader(parsed, argv[i + 1]);
      i += 1;
    } else if (token.startsWith('--header=')) addHeader(parsed, token.slice('--header='.length));
    else if (token.startsWith('-')) parsed.unknown.push(token);
    else parsed.url ??= token;
  }
  return parsed;
}

const HELP_TEXT = `pll doctor — audit what a live-preview deployment actually serves

Usage:
  pll doctor <url> [--admin <origin>] [--header <name: value>]... [--json] [--v2]
  pll migrate <path> [--write] [--only <id,id>]

The URL is fetched twice: once as an ordinary visitor, and once the way the
Payload admin's iframe loads it, with ?preview=true and the iframe's headers.
Most findings come from the difference between the two responses. Redirects
are reported, not followed.

Options:
  -a, --admin <origin>  Admin origin the preview is embedded from. Enables the
                        frame-ancestors check to verify the origin is admitted,
                        not merely that a policy exists.
  -H, --header <h>      A header for the preview request only, as "Name: value";
                        repeat it for more. A preview behind authorizePreview
                        needs an editor's credentials: a Payload session Cookie
                        or an x-preview-token. The visitor request stays
                        anonymous and values are never printed, but a shell
                        keeps them in its history, so prefer a short-lived token.
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
  pll doctor https://example.com/ --header "x-preview-token: $PREVIEW_TOKEN" --v2
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
  if (args.badHeader) {
    // The value is not echoed: a mistyped header can still hold half a token.
    process.stderr.write(
      'pll doctor: --header takes "Name: value", such as --header "x-preview-token: …"\n',
    );
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
      ...(Object.keys(args.headers).length > 0 ? { previewHeaders: args.headers } : {}),
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
