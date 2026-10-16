/**
 * Execute both real-admin readiness predicates against the concrete startup runtime.
 * A requested start may still be waiting for the document parser, before cache,
 * message ingress and the ready handshake are acquired.
 */
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import {
  createSourceFile,
  DiagnosticCategory,
  forEachChild,
  isArrowFunction,
  isCallExpression,
  isPropertyAccessExpression,
  ScriptKind,
  ScriptTarget,
  transpileModule,
  type Node,
} from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { fireMessage, makeRuntime } from './lifecycle-startup-harness';

const owner = createSourceFile(
  'surface-smoke.spec.ts',
  readFileSync('tests/real-payload/surface-smoke.spec.ts', 'utf8'),
  ScriptTarget.Latest,
  true,
  ScriptKind.TS,
);
const predicates: string[] = [];
function visit(node: Node): void {
  if (
    isCallExpression(node) &&
    isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === 'waitForFunction'
  ) {
    const predicate = node.arguments[0];
    if (predicate === undefined || !isArrowFunction(predicate)) {
      throw new Error('Readiness must use an inline source predicate');
    }
    const javascript = transpileModule(`const predicate = (${predicate.getText(owner)});`, {
      compilerOptions: { target: ScriptTarget.ES2022 },
      reportDiagnostics: true,
    });
    if (javascript.diagnostics?.some(({ category }) => category === DiagnosticCategory.Error)) {
      throw new Error('Readiness predicate did not transpile');
    }
    predicates.push(javascript.outputText + '\npredicate();');
  }
  forEachChild(node, visit);
}
visit(owner);
if (predicates.length !== 2) {
  throw new Error('Initial startup and reload must each retain a readiness predicate');
}

describe('real-admin readiness before and after document parsing', () => {
  it('refuses readiness before the real runtime acquires ingress', async () => {
    expect(Object.keys(window).filter((key) => key.startsWith('__sveltekit_'))).toEqual([]);
    document.body.innerHTML = '<h1 data-payload-field="title">saved</h1>';
    const readyState = vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');
    const sendReady = vi.fn();
    const runtime = makeRuntime({ hydration: 'sveltekit', sendReady });
    expect(Object.hasOwn(window, '__livePreview')).toBe(false);
    Object.defineProperty(window, '__livePreview', {
      value: { inspect: () => runtime.inspect() },
      configurable: true,
    });
    try {
      expect(runtime.start()).toBe(true);
      expect(runtime.inspect().started).toBe(true);
      expect(runtime.inspect().hydration).toEqual({ mode: 'sveltekit', state: 'idle' });
      expect(runtime.cache.elementCount).toBe(0);
      expect(sendReady).not.toHaveBeenCalled();
      fireMessage({ type: 'payload-live-preview', data: { title: 'too early' } });
      await vi.advanceTimersByTimeAsync(50);
      expect(document.querySelector('h1')?.textContent).toBe('saved');
      for (const predicate of predicates) {
        expect(runInNewContext(predicate, { window })).toBe(false);
      }
    } finally {
      runtime.destroy();
      readyState.mockRestore();
      Reflect.deleteProperty(window, '__livePreview');
    }
  });

  it('accepts readiness after the real runtime owns cache, bus and handshake', async () => {
    expect(Object.keys(window).filter((key) => key.startsWith('__sveltekit_'))).toEqual([]);
    document.body.innerHTML = '<h1 data-payload-field="title">saved</h1>';
    const readyState = vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');
    const sendReady = vi.fn();
    const runtime = makeRuntime({ hydration: 'sveltekit', sendReady });
    expect(Object.hasOwn(window, '__livePreview')).toBe(false);
    Object.defineProperty(window, '__livePreview', {
      value: { inspect: () => runtime.inspect() },
      configurable: true,
    });
    try {
      runtime.start();
      readyState.mockReturnValue('interactive');
      document.dispatchEvent(new Event('DOMContentLoaded'));
      expect(runtime.inspect().hydration).toEqual({ mode: 'sveltekit', state: 'committed' });
      expect(runtime.cache.elementCount).toBe(1);
      expect(sendReady).toHaveBeenCalledOnce();
      for (const predicate of predicates) {
        expect(runInNewContext(predicate, { window })).toBe(true);
      }
      fireMessage({ type: 'payload-live-preview', data: { title: 'after parse' } });
      await vi.advanceTimersByTimeAsync(50);
      expect(document.querySelector('h1')?.textContent).toBe('after parse');
    } finally {
      runtime.destroy();
      readyState.mockRestore();
      Reflect.deleteProperty(window, '__livePreview');
    }
  });
});
