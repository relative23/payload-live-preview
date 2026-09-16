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
  /** The first `--header` or `--param` that could not be read, as the message to print. */
  usageError: string | undefined;
  /** Query parameter names from every `--param`. */
  params: string[];
}

/** A query parameter name: no separator, no space, and not the next option. */
const PARAM_NAME = /^[^\s&=#?-][^\s&=#]*$/u;

/** An HTTP field name (RFC 9110 token), a colon, then the value. */
const HEADER_LINE = /^([!#$%&'*+.^_`|~0-9A-Za-z-]+):[ \t]*(.*)$/u;

function addHeader(parsed: ParsedArgs, line: string | undefined): void {
  // A missing value would otherwise read the next argument: `https://example.com/`
  // matches as name `https`, and `--v2` as no header at all.
  const match =
    line === undefined || line.startsWith('-') || isAbsoluteUrl(line)
      ? null
      : HEADER_LINE.exec(line);
  const name = match?.[1];
  const value = match?.[2];
  if (name === undefined || value === undefined) {
    // The value is not echoed: a mistyped header can still hold half a token.
    parsed.usageError ??=
      'pll doctor: --header takes "Name: value", such as --header "Cookie: payload-token=…"';
    return;
  }
  // Header names are case-insensitive; a second spelling would be joined onto
  // the first by fetch, and a repeat would silently replace it.
  if (Object.keys(parsed.headers).some((given) => given.toLowerCase() === name.toLowerCase())) {
    parsed.usageError ??= `pll doctor: --header "${name}" is given twice; join the values into one header`;
    return;
  }
  parsed.headers[name] = value;
}

function addParam(parsed: ParsedArgs, name: string | undefined): void {
  if (name === undefined || !PARAM_NAME.test(name)) {
    parsed.usageError ??= 'pll doctor: --param takes a query parameter name, such as --param draft';
    return;
  }
  parsed.params.push(name);
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
    usageError: undefined,
    params: [],
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
    else if (token === '--param') {
      addParam(parsed, argv[i + 1]);
      i += 1;
    } else if (token.startsWith('--param=')) addParam(parsed, token.slice('--param='.length));
    else if (token.startsWith('-')) parsed.unknown.push(token);
    else parsed.url ??= token;
  }
  return parsed;
}

const HELP_TEXT = `pll doctor — audit what a live-preview deployment actually serves

Usage:
  pll doctor <url> [--admin <origin>] [--header <name: value>]... [--param <name>]... [--json] [--v2]
  pll migrate <path> [--write] [--only <id,id>]

The URL is fetched twice: once as an ordinary visitor, without any intent
parameter, and once the way the Payload admin's iframe loads it, with
?preview=true and the iframe's headers.
Most findings come from the difference between the two responses. Redirects
are reported, not followed.

Options:
  -a, --admin <origin>  Admin origin the preview is embedded from. Enables the
                        frame-ancestors check to verify the origin is admitted,
                        not merely that a policy exists.
  -H, --header <h>      A header for the preview request only, as "Name: value";
                        repeat it for more. A preview behind authorizePreview
                        needs an editor's credentials: a Payload session Cookie,
                        or an x-preview-token where the token strategy sets
                        transport: { kind: 'header' }. A signed token travels in
                        the URL by default, as ?previewToken=…, which the visitor
                        request drops. The visitor request stays anonymous and
                        values are never printed, but a shell keeps them in its
                        history, so prefer a short-lived token.
      --param <name>    A query parameter the deployment reads as preview intent,
                        for an adapter whose previewQueryParams replaces the
                        default preview, draft and livePreview; repeat it for
                        more. The first one is what the preview request carries
                        as <name>=true; none of them reaches the visitor request.
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
  pll doctor "https://example.com/?previewToken=$PREVIEW_TOKEN" --v2
  pll doctor https://example.com/ --header "Cookie: payload-token=$PAYLOAD_TOKEN"
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
  if (args.usageError !== undefined) {
    process.stderr.write(`${args.usageError}\n`);
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
      ...(args.params.length > 0 ? { previewQueryParams: args.params } : {}),
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
