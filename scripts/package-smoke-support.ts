/**
 * Repository paths and process primitives shared by the packed-package gate.
 * Command failures are reported from the tail of the output because npm, tsc
 * and publint emit far more than a readable gate report can carry.
 */

import { spawnSync } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PACKAGE_LOCK = resolve(ROOT, 'package-lock.json');
export const TYPE_CONTRACT_ROOT = resolve(ROOT, 'type-tests/packed');
export const API_EXTRACTOR_CONFIG = resolve(ROOT, 'api-extractor.json');
export const API_REPORT_FOLDER = resolve(ROOT, 'etc/api');

export type JsonRecord = Record<string, unknown>;

export interface CommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly status: number;
}

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function run(
  executable: string,
  args: readonly string[],
  cwd: string,
  environment: NodeJS.ProcessEnv = process.env,
): CommandResult {
  const result = spawnSync(executable, args, {
    cwd,
    encoding: 'utf8',
    env: environment,
  });
  if (result.error !== undefined) throw result.error;
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    status: result.status ?? 1,
  };
}

export function detailFor(result: { readonly stdout: string; readonly stderr: string }): string {
  const output = `${result.stdout}\n${result.stderr}`.trim();
  return output.length > 2_000 ? output.slice(-2_000) : output;
}

export function localBinary(name: string): string {
  return resolve(ROOT, 'node_modules/.bin', process.platform === 'win32' ? `${name}.cmd` : name);
}

export async function exists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}
