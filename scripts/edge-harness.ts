/**
 * A `node:vm` context whose globals are the Web platform's and nothing else —
 * no `process`, no `Buffer`, no `require`, no `node:` modules. A built entry
 * that reaches for any of them fails to link here instead of failing on a real
 * edge deployment.
 */

import { readFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
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
    // Web-platform clocks and abort reasons used by server request lifetimes.
    performance,
    DOMException,
    fetch: () => Promise.reject(new Error('edge check: unexpected fetch')),
  };
}

/**
 * The modules of one context by file. A chunk two entries share exists once, as
 * in a runtime, and the promise is what is kept: the linker asks for the same
 * chunk from several importers before the first read of it has finished, and
 * a module that keeps state must not exist twice.
 */
const LOADED = new WeakMap<vm.Context, Map<string, Promise<vm.SourceTextModule>>>();

/**
 * Where a specifier in a built file leads, when it is one of the package's own
 * files under `dist`: a relative path that stays inside it. `undefined` for a
 * bare specifier, a Node builtin or a path that leaves the folder, which an
 * edge runtime does not have.
 */
export function ownChunk(dist: string, from: string, specifier: string): string | undefined {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) return undefined;
  const target = resolve(dirname(from), specifier);
  const inside = relative(dist, target);
  return inside.startsWith('..') || inside === '' ? undefined : target;
}

/**
 * Load a built entry into the context. It may import the package's own chunks,
 * which are loaded the same way, and nothing else.
 */
export async function loadModule(context: vm.Context, file: string): Promise<Exports> {
  const dist = resolve(ROOT, 'dist');
  const loaded = LOADED.get(context) ?? new Map<string, Promise<vm.SourceTextModule>>();
  LOADED.set(context, loaded);
  const load = (path: string): Promise<vm.SourceTextModule> => {
    const known = loaded.get(path);
    if (known !== undefined) return known;
    const module = readFile(path, 'utf8').then(
      (source) =>
        new vm.SourceTextModule(source, { context, identifier: pathToFileURL(path).href }),
    );
    loaded.set(path, module);
    return module;
  };
  const link = (specifier: string, referencing: vm.Module): Promise<vm.SourceTextModule> => {
    const from = fileURLToPath(referencing.identifier);
    const target = ownChunk(dist, from, specifier);
    if (target === undefined) {
      throw new Error(
        `edge check: ${relative(ROOT, from)} imports "${specifier}" — an edge bundle may import the package's own chunks and nothing else`,
      );
    }
    return load(target);
  };
  const module = await load(resolve(ROOT, file));
  await module.link(link);
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
