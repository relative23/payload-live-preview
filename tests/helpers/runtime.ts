import { LivePreviewRuntime, type RuntimeOptions } from '@core/lifecycle';
import { EventEmitter } from '@events/emitter';
import type { FieldRenderer } from '@core/types';

/**
 * One runtime harness for the jsdom suites. They all built the same runtime
 * against the same trusted origin, with the same text renderer and the same
 * message envelope; only the axes that actually differed are parameters here.
 */

export const TRUSTED = 'https://admin.example.com';

/** `string` prints `null` as "null"; `nullSafe` blanks it; `none` is for a renderer never used. */
export type TextFormat = 'string' | 'json' | 'nullSafe' | 'none';

export interface TextRendererOptions {
  /** Records each write, so a suite can assert on writes as well as on the DOM. */
  readonly sink?: string[];
  readonly record?: 'value' | 'fieldName';
  readonly format?: TextFormat;
}

function print(value: unknown, format: Exclude<TextFormat, 'none'>): string {
  if (format === 'string') return String(value);
  if (format === 'json') return typeof value === 'string' ? value : JSON.stringify(value);
  return value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value);
}

export function textRenderer(options: TextRendererOptions = {}): FieldRenderer {
  const { sink, record = 'value', format = 'string' } = options;
  return {
    name: 'text',
    render(target, value) {
      if (format === 'none') return;
      const printed = print(value, format);
      sink?.push(record === 'fieldName' ? target.fieldName : printed);
      target.element.textContent = printed;
    },
  };
}

export interface PostOptions {
  /** Envelope keys beside `data`, such as `globalSlug`. */
  readonly extra?: Record<string, unknown>;
  readonly origin?: string;
  /** Set it to exercise the `parent-or-opener` source policy; omitted by default. */
  readonly source?: Window | null;
}

export function post(data: Record<string, unknown> | undefined, options: PostOptions = {}): void {
  const { extra = {}, origin = TRUSTED, source = null } = options;
  window.dispatchEvent(
    new MessageEvent('message', {
      data: { type: 'payload-live-preview', ...(data === undefined ? {} : { data }), ...extra },
      origin,
      ...(source === null ? {} : { source }),
    }),
  );
}

/** `timeoutMs` is the floor a suite needs when the update is expected to apply nothing. */
/** jsdom ships no IntersectionObserver, and the runtime builds one even when the gate is off. */
export class NoopIntersectionObserver implements IntersectionObserver {
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

export function stubIntersectionObserver(): void {
  globalThis.IntersectionObserver = NoopIntersectionObserver;
}

export interface RuntimeHarness {
  readonly runtime: LivePreviewRuntime;
  readonly emitter: EventEmitter;
  /** Each `warn` call joined into one line, in order. */
  readonly warnings: string[];
  readonly logs: string[];
}

export function createRuntime(overrides: Partial<RuntimeOptions> = {}): RuntimeHarness {
  // Left alone when a suite installed its own, so a stateful stub still wins.
  if (typeof globalThis.IntersectionObserver === 'undefined') stubIntersectionObserver();
  const emitter = overrides.emitter ?? new EventEmitter();
  const warnings: string[] = [];
  const logs: string[] = [];
  const runtime = new LivePreviewRuntime({
    renderers: { text: textRenderer() },
    originMatcher: (origin) => origin === TRUSTED,
    readyTargets: [TRUSTED],
    debounceMs: 0,
    heartbeatMs: 10 * 60_000,
    disableVisibilityGate: true,
    enableA11y: false,
    warn: (...args: unknown[]) => {
      warnings.push(args.map(String).join(' '));
    },
    log: (...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    },
    ...overrides,
    // After the spread so the returned emitter is always the live one.
    emitter,
  });
  return { runtime, emitter, warnings, logs };
}

export function startRuntime(overrides: Partial<RuntimeOptions> = {}): RuntimeHarness {
  const harness = createRuntime(overrides);
  harness.runtime.start();
  return harness;
}
