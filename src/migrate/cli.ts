/**
 * `pll migrate <path> [--write] [--only <id,id>]`, hosted by the `pll` binary.
 * Exit codes: 0 clean, 1 usage or I/O error, 3 when conflicts need a human.
 */
import { runMigrate, type MigrateFileResult } from './runner';

export const MIGRATE_HELP = `pll migrate — rewrite 1.x APIs to their 2.0 names and homes (ADR 0007)

Usage:
  pll migrate <path> [--write] [--only <id,id>]

Without --write the run only reports what it would change. Codemods touch
only names bound from payload-live-preview; anything they cannot rewrite
safely is listed as needing manual attention. Requires ts-morph.

Options:
      --write           Apply the changes (otherwise dry-run)
      --only <ids>      Run only these codemods (comma-separated)
  -h, --help            Show this help

Exit codes:
  0  nothing needs a human (changes applied, or would be with --write)
  1  usage error, unreadable path, or ts-morph is not installed
  3  at least one file needs manual attention
`;

interface MigrateArgs {
  readonly target: string | undefined;
  readonly write: boolean;
  readonly only: readonly string[] | undefined;
  readonly help: boolean;
  readonly unknown: string | undefined;
}

function parseArgs(argv: readonly string[]): MigrateArgs {
  let target: string | undefined;
  let write = false;
  let only: string[] | undefined;
  let help = false;
  let unknown: string | undefined;
  const ids = (value: string): string[] => value.split(',').filter((id) => id.length > 0);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) continue;
    if (token === '-h' || token === '--help') help = true;
    else if (token === '--write') write = true;
    else if (token === '--only') {
      only = ids(argv[index + 1] ?? '');
      index += 1;
    } else if (token.startsWith('--only=')) only = ids(token.slice('--only='.length));
    else if (token.startsWith('-')) unknown ??= token;
    else target ??= token;
  }
  return { target, write, only, help, unknown };
}

function describe(file: MigrateFileResult): string {
  return file.edits.map((edit) => `${edit.codemod}: ${String(edit.count)} line(s)`).join(', ');
}

export async function runMigrateCommand(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(MIGRATE_HELP);
    return 0;
  }
  if (args.unknown !== undefined) {
    process.stderr.write(`pll migrate: unknown option ${args.unknown}\n`);
    return 1;
  }
  if (args.target === undefined) {
    process.stderr.write('pll migrate: a path is required. Try `pll migrate --help`.\n');
    return 1;
  }
  let result;
  try {
    result = await runMigrate(args.target, {
      write: args.write,
      ...(args.only === undefined ? {} : { only: args.only }),
    });
  } catch (error) {
    process.stderr.write(
      `pll migrate: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  }
  for (const file of result.files) {
    if (!file.changed) continue;
    process.stdout.write(
      `${args.write ? 'migrated' : 'would migrate'} ${file.file} (${describe(file)})\n`,
    );
  }
  process.stdout.write(
    `\n${args.write ? 'Migrated' : 'Would migrate'} ${String(result.changedCount)} file(s).` +
      `${args.write ? '' : ' Re-run with --write to apply.'}\n`,
  );
  const conflicted = result.files.filter((file) => file.conflicts.length > 0);
  if (conflicted.length === 0) return 0;
  process.stdout.write(`\n${String(conflicted.length)} file(s) need manual attention:\n`);
  for (const file of conflicted) {
    for (const item of file.conflicts) {
      const where = item.line === undefined ? file.file : `${file.file}:${String(item.line)}`;
      process.stdout.write(`  ${where}: ${item.reason}\n`);
    }
  }
  return 3;
}
