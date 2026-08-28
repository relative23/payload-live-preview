import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type LivePreviewRuntime } from '@core/lifecycle';
import type { FragmentStrategy, RouteStrategy } from '@core/strategies';
import {
  TRUSTED,
  post,
  startRuntime,
  stubIntersectionObserver,
  textRenderer,
  type RuntimeHarness,
} from '../../helpers/runtime';

/**
 * The per-revision changed set and what consumes it: strategy plans see only
 * changed fields, a route refresh re-applies every unsaved field under
 * skipUnchanged, dependents re-apply on the route path, and reveal follows
 * nested bindings. Plus the lifecycle seams around suspend/destroy, ready
 * targets and refreshCache.
 */

let harness: RuntimeHarness | undefined;
let writes: string[];
let scrolled: string[];

interface StartOptions {
  readonly route?: RouteStrategy;
  readonly fragment?: FragmentStrategy;
  readonly skipUnchanged?: boolean;
  readonly dependencies?: Readonly<Record<string, readonly string[]>>;
  readonly revealEditedField?: boolean;
  readonly enableA11y?: boolean;
}

function start(options: StartOptions = {}): LivePreviewRuntime {
  const strategies = {
    ...(options.route === undefined ? {} : { route: options.route }),
    ...(options.fragment === undefined ? {} : { fragment: options.fragment }),
  };
  harness = startRuntime({
    renderers: {
      text: textRenderer({ sink: writes, record: 'fieldName' }),
      // `<a>` resolves to the url renderer; it writes the sibling href field.
      url: {
        name: 'url',
        render(target, value, context) {
          writes.push(target.fieldName);
          target.element.textContent = String(value);
          const href = target.hrefField;
          if (href !== undefined) {
            const sibling = context.allFields[href];
            if (typeof sibling === 'string') target.element.setAttribute('href', sibling);
          }
        },
      },
    },
    skipUnchanged: options.skipUnchanged ?? false,
    revealEditedField: options.revealEditedField ?? false,
    enableA11y: options.enableA11y ?? false,
    eventSourcePolicy: 'any',
    ...(options.dependencies === undefined ? {} : { dependencies: options.dependencies }),
    ...(Object.keys(strategies).length === 0 ? {} : { strategies }),
  });
  return harness.runtime;
}

function update(fields: Record<string, unknown>): Promise<void> {
  post(fields, { extra: { globalSlug: 'home' } });
  return settled();
}

/** Resolves once the revision's patch writes landed, or after a grace period when nothing applies. */
function settled(): Promise<void> {
  return new Promise((resolve) => {
    const emitter = harness?.emitter;
    const off = emitter?.on('afterUpdate', (event) => {
      if (event.source !== 'patch') return;
      off?.();
      setTimeout(resolve, 5);
    });
    setTimeout(() => {
      off?.();
      resolve();
    }, 80);
  });
}

function text(field: string): string | undefined {
  return document.querySelector(`[data-payload-field="${field}"]`)?.textContent ?? undefined;
}

beforeEach(() => {
  stubIntersectionObserver();
  writes = [];
  scrolled = [];
  Element.prototype.scrollIntoView = function scrollIntoView(this: Element): void {
    scrolled.push(this.getAttribute('data-payload-field') ?? this.tagName);
  };
  document.head.innerHTML = '';
  document.body.innerHTML =
    '<h1 data-payload-field="title">Saved title</h1><p data-payload-field="footer">Saved footer</p>';
});
afterEach(() => {
  harness?.runtime.destroy();
  harness = undefined;
});

describe('the changed set', () => {
  it('hands strategies only the fields that changed, though every message carries the whole document', async () => {
    const routePlans: string[][] = [];
    const fragmentPlans: string[][] = [];
    const route: RouteStrategy = {
      plan: (_root, changed) => {
        routePlans.push([...changed].sort());
        return false;
      },
      refresh: () => Promise.resolve('refreshed'),
    };
    const fragment: FragmentStrategy = {
      plan: (_root, changed) => {
        fragmentPlans.push([...changed].sort());
        return [];
      },
      render: () => Promise.resolve({ rendered: 0, failed: 0, superseded: 0 }),
    };
    start({ route, fragment });
    await update({ title: 'A', footer: 'B' });
    await update({ title: 'A', footer: 'C' });
    await update({ title: 'A', footer: 'C' });
    expect(routePlans).toEqual([['footer', 'title'], ['footer'], []]);
    expect(fragmentPlans).toEqual([['footer', 'title'], ['footer'], []]);
  });

  it('includes the dependents of a changed field', async () => {
    const plans: string[][] = [];
    const route: RouteStrategy = {
      plan: (_root, changed) => {
        plans.push([...changed].sort());
        return false;
      },
      refresh: () => Promise.resolve('refreshed'),
    };
    start({ route, dependencies: { title: ['footer'] } });
    await update({ title: 'A', footer: 'B' });
    await update({ title: 'A2', footer: 'B' });
    expect(plans[1]).toEqual(['footer', 'title']);
  });
});

describe('skipUnchanged', () => {
  it('re-applies a binding whose sibling href field changed, though its own value did not', async () => {
    document.body.innerHTML =
      '<a data-payload-field="ctaLabel" data-payload-href="ctaUrl" href="https://old.example">old</a>';
    start({ skipUnchanged: true });
    await update({ ctaLabel: 'Docs', ctaUrl: 'https://old.example' });
    writes.length = 0;
    // Only the sibling changes: the link text is identical, the href is not.
    await update({ ctaLabel: 'Docs', ctaUrl: 'https://new.example' });
    expect(writes).toContain('ctaLabel');
  });

  it('still skips a binding when neither its value nor its siblings changed', async () => {
    document.body.innerHTML =
      '<a data-payload-field="ctaLabel" data-payload-href="ctaUrl" href="https://old.example">old</a>';
    start({ skipUnchanged: true });
    await update({ ctaLabel: 'Docs', ctaUrl: 'https://old.example' });
    writes.length = 0;
    await update({ ctaLabel: 'Docs', ctaUrl: 'https://old.example' });
    expect(writes).toEqual([]);
  });
});

describe('route refresh', () => {
  /** "Re-renders" the route from the saved document by rewriting every binding. */
  function savedRoute(): RouteStrategy {
    return {
      plan: (_root, changed) => changed.has('title'),
      refresh: () => {
        for (const element of document.querySelectorAll('[data-payload-field]')) {
          element.textContent = 'Saved';
        }
        return Promise.resolve('refreshed');
      },
    };
  }

  it('re-applies every unsaved field onto the fresh markup under skipUnchanged', async () => {
    start({ route: savedRoute(), skipUnchanged: true });
    await update({ title: 'T1', footer: 'F1' });
    expect(text('footer')).toBe('F1');
    // Only the title changes; the refresh rewrote the footer to its saved value.
    await update({ title: 'T2', footer: 'F1' });
    expect(text('title')).toBe('T2');
    expect(text('footer')).toBe('F1');
  });

  it('re-applies dependents when the revision took the route path', async () => {
    const route: RouteStrategy = {
      plan: (_root, changed) => changed.has('title'),
      refresh: () => Promise.resolve('failed'),
    };
    start({ route, skipUnchanged: true, dependencies: { title: ['footer'] } });
    await update({ title: 'T1', footer: 'F' });
    writes.length = 0;
    await update({ title: 'T2', footer: 'F' });
    expect(writes).toContain('footer');
  });
});

describe('reveal', () => {
  it('follows a nested binding such as hero.title', async () => {
    document.body.innerHTML = '<p data-payload-field="hero.title">old</p>';
    start({ revealEditedField: true });
    await update({ hero: { title: 'a' } });
    expect(scrolled).toEqual([]);
    await update({ hero: { title: 'b' } });
    expect(scrolled).toEqual(['hero.title']);
  });

  it('does not let an incomparable value claim the reveal from a field that changed', async () => {
    document.body.innerHTML =
      '<p data-payload-field="huge">old</p><p data-payload-field="title">old</p>';
    start({ revealEditedField: true });
    // Longer than the identity size limit, so it never gets an identity.
    const huge = 'x'.repeat(70_000);
    await update({ huge, title: 'a' });
    await update({ huge, title: 'b' });
    expect(scrolled).toEqual(['title']);
  });

  it('treats an element new to the page as baseline, not as an edit', async () => {
    start({ revealEditedField: true });
    await update({ title: 'a', footer: 'b' });
    document.body.insertAdjacentHTML('beforeend', '<p data-payload-field="extra">x</p>');
    harness?.runtime.refreshCache();
    await update({ title: 'a', footer: 'b', extra: 'y' });
    expect(scrolled).toEqual([]);
  });
});

describe('lifecycle seams', () => {
  it('narrows the ready handshake to the locked origin after a bfcache restore', () => {
    const handshakes: (readonly string[])[] = [];
    let locked: string | undefined;
    // Read per handshake: before the lock every candidate, afterwards only it.
    const rt = startRuntime({
      readyTargets: () => (locked === undefined ? [TRUSTED, 'https://other.example'] : [locked]),
      eventSourcePolicy: 'any',
      sendReady: (origins) => {
        handshakes.push(origins);
      },
    });
    rt.emitter.on('connect', (event) => {
      locked = event.origin;
    });
    harness = rt;
    expect(handshakes[0]).toEqual([TRUSTED, 'https://other.example']);
    post({ title: 'a' });
    rt.runtime.suspend();
    rt.runtime.start();
    expect(handshakes[handshakes.length - 1]).toEqual([TRUSTED]);
  });

  it('rebuilds the cache once when refreshCache follows a body swap', async () => {
    const rt = start();
    let refreshes = 0;
    harness!.emitter.on('cacheRefresh', () => {
      refreshes += 1;
    });
    const body = document.createElement('body');
    body.innerHTML = '<h1 data-payload-field="title">Swapped</h1>';
    document.documentElement.replaceChild(body, document.body);
    rt.refreshCache();
    await new Promise((resolve) => setTimeout(resolve, 10));
    // One rebuild, not two: refreshCache must not follow the replaced root and
    // then rebuild again on top of it.
    expect(refreshes).toBe(1);
    expect(rt.cache.get('title')?.[0]?.element.textContent).toBe('Swapped');
  });
});
