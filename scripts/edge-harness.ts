/**
 * A `node:vm` context whose globals are the Web platform's and nothing else —
 * no `process`, no `Buffer`, no `require`, no `node:` modules. A built entry
 * that reaches for any of them fails to link here instead of failing on a real
 * edge deployment.
 */

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import vm from 'node:vm';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export type Exports = Record<string, unknown>;

export interface EdgeCase {
  readonly name: string;
  readonly run: () => Promise<void>;
}

export function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

export function edgeGlobals(): Record<string, unknown> {
  return {
    Request,
    Response,
    Headers,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    crypto,
    btoa,
    atob,
    console,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    structuredClone,
    AbortController,
    AbortSignal,
    fetch: () => Promise.reject(new Error('edge check: unexpected fetch')),
  };
}

export async function loadModule(context: vm.Context, file: string): Promise<Exports> {
  const source = await readFile(resolve(ROOT, file), 'utf8');
  const identifier = pathToFileURL(resolve(ROOT, file)).href;
  const module = new vm.SourceTextModule(source, { context, identifier });
  await module.link((specifier: string) => {
    throw new Error(
      `edge check: ${file} imports "${specifier}" — an edge bundle must be self-contained`,
    );
  });
  await module.evaluate();
  return module.namespace as Exports;
}

export async function runEdgeCases(cases: readonly EdgeCase[]): Promise<void> {
  const failures: string[] = [];
  for (const item of cases) {
    try {
      await item.run();
      console.log(`PASS edge: ${item.name}`);
    } catch (error) {
      failures.push(item.name);
      console.error(
        `FAIL edge: ${item.name} — ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  if (failures.length > 0) {
    throw new Error(`edge runtime gate failed for ${String(failures.length)} case(s)`);
  }
}
