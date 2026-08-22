import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '@events/emitter';
import { LivePreviewRuntime } from '@core/lifecycle';
import type { FieldRenderer } from '@core/types';
import { DIAGNOSTIC_CODES } from '@core/diagnostic-codes';

// process.cwd() is the repository root under vitest, as the quality tests assume.
const SRC = resolve(process.cwd(), 'src');

/** Every `.ts` under `src/`, minus the generated inline runtime bundle. */
function sourceFiles(directory: string, found: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      sourceFiles(path, found);
    } else if (entry.endsWith('.ts') && !path.endsWith('runtime.generated.ts')) {
      found.push(path);
    }
  }
  return found;
}

/** Codes as they are actually written at reporting sites, by file. */
function emittedCodes(): Map<string, Set<string>> {
  const byFile = new Map<string, Set<string>>();
  for (const path of sourceFiles(SRC)) {
    if (path.endsWith('diagnostic-codes.ts')) continue;
    const matches = readFileSync(path, 'utf8').match(/LP\d{4}/gu);
    if (matches === null) continue;
    byFile.set(relative(SRC, path), new Set(matches));
  }
  return byFile;
}

const REGISTERED = new Set<string>(Object.values(DIAGNOSTIC_CODES));

describe('diagnostic code registry', () => {
  it('assigns every code exactly once', () => {
    const values = Object.values(DIAGNOSTIC_CODES);
    expect(new Set(values).size).toBe(values.length);
  });

  it('uses the documented LPnnnn shape throughout', () => {
    for (const code of REGISTERED) {
      expect(code).toMatch(/^LP\d{4}$/u);
    }
  });

  it('is frozen, so a consumer cannot reassign a code at runtime', () => {
    expect(Object.isFrozen(DIAGNOSTIC_CODES)).toBe(true);
  });
});

describe('registry against the code actually shipped', () => {
  it('emits no code that the registry does not define', () => {
    // Catches a typo in a literal at a reporting site, which no type check
    // can see: the warning strings are plain templates.
    const unknown: string[] = [];
    for (const [file, codes] of emittedCodes()) {
      for (const code of codes) {
        if (!REGISTERED.has(code)) unknown.push(`${file}: ${code}`);
      }
    }
    expect(unknown).toEqual([]);
  });

  it('defines no code that nothing reports', () => {
    // A registry entry with no emitter is a promise the runtime does not keep.
    // LP0604 is deliberately reserved and therefore deliberately absent from
    // the registry — see the module header.
    const emitted = new Set<string>();
    for (const codes of emittedCodes().values()) {
      for (const code of codes) emitted.add(code);
    }
    const orphaned = [...REGISTERED].filter((code) => !emitted.has(code)).sort();
    expect(orphaned).toEqual([]);
  });

  it('keeps LP0604 reserved rather than reassigned', () => {
    expect(REGISTERED.has('LP0604')).toBe(false);
  });
});

class IO implements IntersectionObserver {
  readonly root: Element | Document | null = null;
  readonly rootMargin = '';
  readonly thresholds: readonly number[] = [];
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

const TRUSTED = 'https://admin.example.com';

function fireUpdate(data: unknown): void {
  window.dispatchEvent(
    new MessageEvent('message', {
      data: { type: 'payload-live-preview', data },
      origin: TRUSTED,
    }),
  );
}

function createRuntime(
  renderer: FieldRenderer,
  emitter: EventEmitter,
  warnings: string[],
  options: Record<string, unknown> = {},
): LivePreviewRuntime {
  return new LivePreviewRuntime({
    renderers: { text: renderer },
    originMatcher: (origin) => origin === TRUSTED,
    readyTargets: [TRUSTED],
    emitter,
    debounceMs: 0,
    heartbeatMs: 10 * 60_000,
    disableVisibilityGate: true,
    enableA11y: false,
    warn: (...args: unknown[]) => {
      warnings.push(args.map(String).join(' '));
    },
    ...options,
  });
}

function workingRenderer(): FieldRenderer {
  return {
    name: 'text',
    render(target, value) {
      target.element.textContent = typeof value === 'string' ? value : '';
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  globalThis.IntersectionObserver = IO;
  document.body.innerHTML = '<h1 data-payload-field="title">t</h1>';
});

afterEach(() => {
  vi.useRealTimers();
});

describe('codes reach the reader', () => {
  it('stamps LP0201 on the orphan-field warning', async () => {
    const warnings: string[] = [];
    const runtime = createRuntime(workingRenderer(), new EventEmitter(), warnings);
    runtime.start();
    fireUpdate({ nosuchfield: 'x' });
    await vi.advanceTimersByTimeAsync(50);

    expect(warnings.some((w) => w.includes('LP0201'))).toBe(true);
    runtime.destroy();
  });

  it('stamps LP0301 on the visibility-gate warning', async () => {
    const warnings: string[] = [];
    const runtime = createRuntime(workingRenderer(), new EventEmitter(), warnings, {
      disableVisibilityGate: false,
      visibilityGateThreshold: 0,
    });
    runtime.start();
    fireUpdate({ title: 'x' });
    await vi.advanceTimersByTimeAsync(50);

    expect(warnings.some((w) => w.includes('LP0301'))).toBe(true);
    runtime.destroy();
  });

  it('puts LP0603 on the error event when a renderer throws', async () => {
    const emitter = new EventEmitter();
    const codes: string[] = [];
    const contexts: string[] = [];
    // Collect only. The emitter swallows handler throws, so an assertion made
    // in here could never fail the test — it would look like a check and be
    // none.
    emitter.on('error', (e) => {
      codes.push(e.code);
      contexts.push(e.context);
    });
    const runtime = createRuntime(
      {
        name: 'text',
        render() {
          throw new Error('renderer exploded');
        },
      },
      emitter,
      [],
    );
    runtime.start();
    fireUpdate({ title: 'x' });
    await vi.advanceTimersByTimeAsync(50);

    expect(codes).toContain('LP0603');
    // `context` stays for readers who want the human-readable origin.
    expect(contexts).toContain('renderer');
    runtime.destroy();
  });
});

describe('every emitted code is asserted somewhere', () => {
  /** Collect `error` event codes without asserting inside the handler: the
   *  emitter swallows handler throws, so an in-handler expect can never fail
   *  a test. */
  function collectCodes(emitter: EventEmitter): string[] {
    const codes: string[] = [];
    emitter.on('error', (e) => {
      codes.push(e.code);
    });
    return codes;
  }

  it('reports LP0603 when resolving a renderer throws, not only when one throws', async () => {
    // A second, distinct path: resolution failure versus render failure.
    const emitter = new EventEmitter();
    const codes = collectCodes(emitter);
    const runtime = createRuntime(workingRenderer(), emitter, [], {
      resolveRenderer: () => {
        throw new Error('cannot resolve');
      },
    });
    runtime.start();
    fireUpdate({ title: 'x' });
    await vi.advanceTimersByTimeAsync(50);

    expect(codes).toContain('LP0603');
    runtime.destroy();
  });

  it('reports LP0602 when a transform throws', async () => {
    const emitter = new EventEmitter();
    const codes = collectCodes(emitter);
    const runtime = createRuntime(workingRenderer(), emitter, [], {
      transformValue: () => {
        throw new Error('transform exploded');
      },
    });
    runtime.start();
    fireUpdate({ title: 'x' });
    await vi.advanceTimersByTimeAsync(50);

    expect(codes).toContain('LP0602');
    runtime.destroy();
  });

  it('reports LP0502 when a preview token is rejected', async () => {
    const emitter = new EventEmitter();
    const codes = collectCodes(emitter);
    const runtime = createRuntime(workingRenderer(), emitter, [], {
      validateToken: () => false,
    });
    runtime.start();
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'payload-live-preview', previewToken: 'nope', data: { title: 'x' } },
        origin: TRUSTED,
      }),
    );
    await vi.advanceTimersByTimeAsync(50);

    expect(codes).toContain('LP0502');
    runtime.destroy();
  });

  it('logs LP0501 when a message is rejected', async () => {
    const logs: string[] = [];
    const runtime = createRuntime(workingRenderer(), new EventEmitter(), [], {
      validateToken: () => false,
      log: (...args: unknown[]) => {
        logs.push(args.map(String).join(' '));
      },
    });
    runtime.start();
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'payload-live-preview', previewToken: 'nope', data: { title: 'x' } },
        origin: TRUSTED,
      }),
    );
    await vi.advanceTimersByTimeAsync(50);

    expect(logs.some((l) => l.includes('LP0501'))).toBe(true);
    runtime.destroy();
  });

  it('reports LP0606 when a ready handshake retry cannot be sent', async () => {
    // The immediate handshake at delay 0 bypasses the guarded helper and
    // propagates to start()'s caller. LP0606 covers the later retries, which
    // fire from timer callbacks where nothing could catch them.
    const emitter = new EventEmitter();
    const codes = collectCodes(emitter);
    let attempts = 0;
    const runtime = createRuntime(workingRenderer(), emitter, [], {
      sendReady: () => {
        attempts += 1;
        if (attempts > 1) throw new Error('no parent');
      },
    });
    runtime.start();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(attempts).toBeGreaterThan(1);
    expect(codes).toContain('LP0606');
    runtime.destroy();
  });

  it('warns LP0401 when a value is refused as an unsafe attribute write', async () => {
    const warnings: string[] = [];
    document.body.innerHTML = '<a data-payload-field="link" data-payload-attribute="href">x</a>';
    const runtime = createRuntime(workingRenderer(), new EventEmitter(), warnings);
    runtime.start();
    fireUpdate({ link: 'javascript:alert(1)' });
    await vi.advanceTimersByTimeAsync(50);

    expect(warnings.some((w) => w.includes('LP0401'))).toBe(true);
    runtime.destroy();
  });
});
