#!/usr/bin/env node
/**
 * `pll-codegen` CLI — runs the type generator from the command line.
 *
 *   npx pll-codegen \
 *     --config backend/src/payload.config.ts \
 *     --out frontend/src/payload-types.ts
 *
 * Exit codes:
 *   0 — generation succeeded (warnings ok)
 *   1 — fatal error (config not found, parse error)
 *   2 — generation produced zero globals AND zero collections —
 *       almost certainly a configuration mismatch
 *
 * @module @codegen/cli
 */

import { generateTypes } from './index';

interface ParsedArgs {
  configPath: string | undefined;
  outFile: string | undefined;
  tsConfigFilePath: string | undefined;
  showHelp: boolean;
  quiet: boolean;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    configPath: undefined,
    outFile: undefined,
    tsConfigFilePath: undefined,
    showHelp: false,
    quiet: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '-h' || token === '--help') {
      parsed.showHelp = true;
      continue;
    }
    if (token === '-q' || token === '--quiet') {
      parsed.quiet = true;
      continue;
    }
    if (token === '--config' || token === '-c') {
      parsed.configPath = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === '--out' || token === '-o') {
      parsed.outFile = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === '--tsconfig') {
      parsed.tsConfigFilePath = argv[i + 1];
      i += 1;
      continue;
    }
    if (token?.startsWith('--config=')) {
      parsed.configPath = token.slice('--config='.length);
      continue;
    }
    if (token?.startsWith('--out=')) {
      parsed.outFile = token.slice('--out='.length);
      continue;
    }
    if (token?.startsWith('--tsconfig=')) {
      parsed.tsConfigFilePath = token.slice('--tsconfig='.length);
      continue;
    }
  }
  return parsed;
}

const HELP_TEXT = `pll-codegen — generate TypeScript types from a Payload config

Usage:
  pll-codegen --config <path> --out <path> [--quiet]

Options:
  -c, --config <path>   Path to payload.config.ts (required)
  -o, --out <path>      Output file for generated types (required)
      --tsconfig <path> Use this tsconfig for cross-file import resolution
  -q, --quiet           Suppress non-error logging
  -h, --help            Show this help

Examples:
  pll-codegen --config backend/src/payload.config.ts --out frontend/src/payload-types.ts
  pll-codegen -c ./payload.config.ts -o ./generated.ts
`;

export async function run(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv);
  if (args.showHelp) {
    process.stdout.write(HELP_TEXT);
    return 0;
  }
  if (!args.configPath || !args.outFile) {
    process.stderr.write(
      'pll-codegen: --config and --out are required. Try `pll-codegen --help`.\n',
    );
    return 1;
  }
  try {
    const result = await generateTypes({
      configPath: args.configPath,
      outFile: args.outFile,
      ...(args.tsConfigFilePath !== undefined ? { tsConfigFilePath: args.tsConfigFilePath } : {}),
    });
    const slugCount = result.schema.globals.length + result.schema.collections.length;
    if (!args.quiet) {
      process.stdout.write(
        `pll-codegen: wrote ${result.outFile} ` +
          `(${result.schema.globals.length} globals, ${result.schema.collections.length} collections)\n`,
      );
      for (const diagnostic of result.diagnostics) {
        process.stderr.write(`  warning: ${diagnostic}\n`);
      }
    }
    if (slugCount === 0) {
      process.stderr.write(
        'pll-codegen: no globals or collections found — check that the config path is correct.\n',
      );
      return 2;
    }
    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`pll-codegen: ${message}\n`);
    return 1;
  }
}

function isCliInvocation(): boolean {
  if (typeof process === 'undefined') return false;
  const entry = process.argv[1];
  if (!entry) return false;
  return entry.includes('pll-codegen') || entry.includes('codegen-cli');
}

if (isCliInvocation()) {
  // Direct invocation via the bin shim — run and exit with the code.
  void run(process.argv.slice(2)).then((code) => {
    process.exit(code);
  });
}
