import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateInlineScript } from '@inline/generator';
import { LEAN_RUNTIME } from '@/lean';
// Importing the harness installs its hooks: fake timers, a framed window, an
// IntersectionObserver stub and a clean `__livePreview` per test.
import './runtime-harness';

/**
 * The lean artifact, run as a page runs it: the generated script is evaluated
 * in this document, and what it does — and refuses to do — is read off the DOM.
 *
 * Testing the modules would prove nothing here. The profile is a property of
 * the *build*: what makes it lean is which files esbuild left out, and only the
 * built string can show that.
 */

const ADMIN = 'https://admin.example.com';

interface Runtime {
  destroy: () => void;
  inspect: () => { started: boolean };
}

function livePreview(): Runtime | undefined {
  return (window as Window & { __livePreview?: Runtime }).__livePreview;
}

/** Evaluate a generated inline script the way a `<script>` tag would. */
function run(script: string): void {
  // The artifact under test is a classic script; running it is the point.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const evaluate = new Function(script) as () => void;
  evaluate();
}

function post(data: Record<string, unknown>): void {
  window.dispatchEvent(
    new MessageEvent('message', {
      origin: ADMIN,
      source: window.parent,
      data: { type: 'payload-live-preview', globalSlug: 'home', data },
    }),
  );
}

const script = (profile: 'full' | 'lean'): string =>
  generateInlineScript({
    allowedOrigins: [ADMIN],
    eventSourcePolicy: 'any',
    debounceMs: 0,
    ...(profile === 'lean' ? { runtime: LEAN_RUNTIME } : {}),
  });

let warnings: string[] = [];

beforeEach(() => {
  warnings = [];
  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    warnings.push(args.map(String).join(' '));
  });
  document.body.innerHTML = '';
});

afterEach(() => {
  livePreview()?.destroy();
  vi.restoreAllMocks();
});

describe('the lean profile, as a page receives it', () => {
  it('is smaller than the full one and still patches a bound field', async () => {
    document.body.innerHTML = '<h1 data-payload-field="title">From the server</h1>';
    expect(script('lean').length).toBeLessThan(script('full').length);

    run(script('lean'));
    expect(livePreview()?.inspect().started).toBe(true);
    post({ title: 'Typed in the admin' });
    await vi.waitFor(() => {
      expect(document.querySelector('h1')?.textContent).toBe('Typed in the admin');
    });
  });

  it('says which feature it does not carry instead of silently doing nothing', async () => {
    document.body.innerHTML =
      '<ul data-payload-field="tags" data-payload-type="array" ' +
      'data-payload-array-template="<li>{{value}}</li>"><li>one</li></ul>';

    run(script('lean'));
    post({ tags: ['one', 'two'] });

    await vi.waitFor(() => {
      expect(warnings.join('\n')).toContain('structural arrays');
    });
    expect(warnings.join('\n')).toContain('LP0104');
    // The markup is left exactly as the server rendered it — never half-applied.
    expect(document.querySelectorAll('li')).toHaveLength(1);
  });

  it('reports the announcer it leaves out, once, when the page asked for one', () => {
    run(script('lean'));

    const reported = warnings.filter((line) => line.includes('screen-reader announcements'));
    expect(reported).toHaveLength(1);
    expect(document.getElementById('payload-live-preview-a11y')).toBeNull();
  });

  it('keeps the full profile complete: the same page renders the array', async () => {
    document.body.innerHTML =
      '<ul data-payload-field="tags" data-payload-type="array" ' +
      'data-payload-array-template="<li>{{value}}</li>"><li>one</li></ul>';

    run(script('full'));
    post({ tags: ['one', 'two'] });

    await vi.waitFor(() => {
      expect(document.querySelectorAll('li')).toHaveLength(2);
    });
    expect(warnings.join('\n')).not.toContain('LP0104');
  });
});

describe('generateInlineScript with a profile', () => {
  it('refuses a lean runtime with a strategy it cannot run', () => {
    // Both preludes talk to a strategy runner the lean artifact does not have,
    // so the combination is a configuration error, not a silent no-op.
    expect(() => generateInlineScript({ runtime: LEAN_RUNTIME, fragmentEndpoint: '/f' })).toThrow(
      /lean/u,
    );
    expect(() => generateInlineScript({ runtime: LEAN_RUNTIME, routeStrategy: true })).toThrow(
      /lean/u,
    );
  });

  it('embeds the full runtime unless an artifact is passed', () => {
    const full = script('full');
    expect(full).toBe(
      generateInlineScript({ allowedOrigins: [ADMIN], eventSourcePolicy: 'any', debounceMs: 0 }),
    );
    expect(full.length).toBeGreaterThan(script('lean').length);
  });
});
