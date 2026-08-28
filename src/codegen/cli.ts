#!/usr/bin/env node
/**
 * `pll-codegen --config <path> --out <path>`. Exit codes: 0 generated
 * (warnings allowed), 1 fatal error, 2 nothing found — the output is left
 * untouched, since an empty schema almost always means a wrong config path.
 */
import { generateTypes } from './index';

interface ParsedArgs {
  configPath: string | undefined;
  outFile: string | undefined;
  inventoryFile: string | undefined;
  tsConfigFilePath: string | undefined;
  showHelp: boolean;
  quiet: boolean;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    configPath: undefined,
    outFile: undefined,
    inventoryFile: undefined,
    tsConfigFilePath: undefined,
    showHelp: false,
    quiet: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === undefined) continue;
    if (token === '-h' || token === '--help') parsed.showHelp = true;
    else if (token === '-q' || token === '--quiet') parsed.quiet = true;
    else if (token === '--config' || token === '-c') {
      parsed.configPath = argv[i + 1];
      i += 1;
    } else if (token === '--out' || token === '-o') {
      parsed.outFile = argv[i + 1];
      i += 1;
    } else if (token === '--inventory') {
      parsed.inventoryFile = argv[i + 1];
      i += 1;
    } else if (token === '--tsconfig') {
      parsed.tsConfigFilePath = argv[i + 1];
      i += 1;
    } else if (token.startsWith('--config=')) parsed.configPath = token.slice('--config='.length);
    else if (token.startsWith('--out=')) parsed.outFile = token.slice('--out='.length);
    else if (token.startsWith('--inventory=')) {
      parsed.inventoryFile = token.slice('--inventory='.length);
    } else if (token.startsWith('--tsconfig=')) {
      parsed.tsConfigFilePath = token.slice('--tsconfig='.length);
    }
  }
  return parsed;
}

const HELP_TEXT = `pll-codegen — generate TypeScript types from a Payload config

Usage:
  pll-codegen --config <path> --out <path> [--inventory <path>] [--quiet]

Options:
  -c, --config <path>   Path to payload.config.ts (required)
  -o, --out <path>      Output file for generated types (required)
      --inventory <path> Also write the preview inventory (JSON) here
      --tsconfig <path> Use this tsconfig for cross-file import resolution
  -q, --quiet           Suppress non-error logging
  -h, --help            Show this help

Exit codes:
  0  types written (warnings, if any, on stderr)
  1  fatal error
  2  no globals or collections found; nothing was written

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
  if (args.configPath === undefined || args.outFile === undefined) {
    process.stderr.write(
      'pll-codegen: --config and --out are required. Try `pll-codegen --help`.\n',
    );
    return 1;
  }
  try {
    const result = await generateTypes({
      configPath: args.configPath,
      outFile: args.outFile,
      ...(args.inventoryFile !== undefined ? { inventoryFile: args.inventoryFile } : {}),
      ...(args.tsConfigFilePath !== undefined ? { tsConfigFilePath: args.tsConfigFilePath } : {}),
    });
    const { globals, collections } = result.schema;
    const slugCount = globals.length + collections.length;
    if (!args.quiet && result.outFile !== undefined) {
      process.stdout.write(
        `pll-codegen: wrote ${result.outFile} (${String(globals.length)} globals, ${String(collections.length)} collections)\n`,
      );
    }
    if (!args.quiet && result.inventoryFile !== undefined) {
      const fieldCount = [...result.inventory.globals, ...result.inventory.collections].reduce(
        (total, entry) => total + entry.fields.length,
        0,
      );
      process.stdout.write(
        `pll-codegen: wrote ${result.inventoryFile} (${String(fieldCount)} addressable fields)\n`,
      );
    }
    if (!args.quiet || slugCount === 0) {
      for (const diagnostic of result.diagnostics) {
        process.stderr.write(`  warning: ${diagnostic}\n`);
      }
    }
    if (slugCount === 0) {
      process.stderr.write(
        'pll-codegen: no globals or collections found; nothing was written. Check that the config path is correct.\n',
      );
      return 2;
    }
    return 0;
  } catch (error) {
    process.stderr.write(
      `pll-codegen: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  }
}

/** Matches the entry's basename only, so a project path containing `pll-codegen` never runs this on import. */
export function isCliInvocation(argv: readonly (string | undefined)[] = process.argv): boolean {
  if (typeof process === 'undefined') return false;
  const entry = argv[1];
  if (entry === undefined || entry === '') return false;
  const name = entry.split(/[\\/]/u).pop() ?? '';
  return name === 'pll-codegen' || name === 'pll-codegen.cmd' || name.startsWith('codegen-cli');
}

if (isCliInvocation()) {
  void run(process.argv.slice(2)).then((code) => {
    process.exit(code);
  });
}
