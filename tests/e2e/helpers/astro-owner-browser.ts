/**
 * Capture bounded presentation and lifecycle observations, never login material.
 * Native tests still assert the actual React DOM; an event alone is not a pass.
 */
import type { Frame, Page } from '@playwright/test';
import type { startNativeContinuation } from './native-continuation';

export async function sendOwnerRevision(
  fixture: Awaited<ReturnType<typeof startNativeContinuation>>,
  page: Page,
  editor: 'a' | 'b',
  locale: 'de' | 'en',
  fields: Record<string, unknown>,
): Promise<void> {
  await page.evaluate(
    ({ locale, data }) => {
      document.querySelector<HTMLIFrameElement>('#preview')!.contentWindow!.postMessage(
        {
          type: 'payload-live-preview',
          collectionSlug: 'articles',
          locale,
          data,
        },
        location.origin,
      );
    },
    {
      locale,
      data: { id: Number(fixture.backend.ids['article-' + editor]), show: true, ...fields },
    },
  );
}

export async function observeReactOwners(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const lifecycle: unknown[] = [];
    const updates: unknown[] = [];
    const timeline: unknown[] = [];
    const violations: string[] = [];
    Object.assign(window, {
      ownerLifecycle: lifecycle,
      ownerUpdates: updates,
      ownerTimeline: timeline,
      resourceCspViolations: violations,
    });
    document.addEventListener('securitypolicyviolation', (event) =>
      violations.push(event.violatedDirective),
    );
    window.addEventListener('plp:test:owner-lifecycle', (event) => {
      if (lifecycle.length < 100) lifecycle.push((event as CustomEvent).detail);
      if (timeline.length < 100) timeline.push((event as CustomEvent).detail);
    });
    document.addEventListener(
      'astro:hydrate',
      (event) => {
        const root = (event.target as Element).querySelector('[data-owner-id]');
        if (root && timeline.length < 100) {
          timeline.push({
            phase: 'native-hydrate',
            owner: root.getAttribute('data-testid'),
            ready: root.getAttribute('data-ready'),
          });
        }
      },
      true,
    );
    document.addEventListener(
      'payload-live-preview:update',
      (event) => {
        const detail = (
          event as CustomEvent<{ fields: { title?: unknown }; revision: number; locale?: string }>
        ).detail;
        if (updates.length < 100) {
          updates.push({
            revision: detail.revision,
            locale: detail.locale,
            title: detail.fields.title,
          });
        }
        const root = (event.target as Element).querySelector('[data-owner-id]');
        if (timeline.length < 100) {
          timeline.push({
            phase: 'island-event',
            revision: detail.revision,
            owner: root?.getAttribute('data-testid'),
            ready: root?.getAttribute('data-ready'),
          });
        }
      },
      true,
    );
  });
}

export async function readReactOwners(frame: Frame) {
  return frame.evaluate(() => ({
    revisions: (document.querySelector('plp-astro-preview')
      ? Reflect.get(document.querySelector('plp-astro-preview')!, 'previewRevisions')
      : null) as {
      accepted: number;
      completed: number;
    } | null,
    owners: Array.from(document.querySelectorAll('[data-owner-id]'), (element) => ({
      owner: element.getAttribute('data-testid'),
      ready: element.getAttribute('data-ready'),
      revision: element.getAttribute('data-revision'),
      pending: element.getAttribute('data-pending'),
      title: element.querySelector('[data-testid="owner-title"]')?.textContent ?? null,
      derived: element.querySelector('[data-testid="owner-derived"]')?.textContent ?? null,
      counter: element.querySelector('[data-testid="owner-counter"]')?.textContent ?? null,
      locale: element.getAttribute('data-owner-locale'),
      subject: element.getAttribute('data-owner-subject'),
      path: element.getAttribute('data-owner-path'),
      awaitingHydration: element.closest('astro-island')?.hasAttribute('ssr'),
    })),
    outerTitles: Array.from(
      document.querySelectorAll('[data-testid="resource-title"]'),
      (element) => element.textContent,
    ),
    fragmentRenders: document.querySelector('[data-testid="renders"]')?.textContent,
    updates: Reflect.get(window, 'ownerUpdates') as { revision: number; title: string }[],
    lifecycle: Reflect.get(window, 'ownerLifecycle') as {
      owner: string;
      phase: string;
      revision: number;
    }[],
    timeline: Reflect.get(window, 'ownerTimeline') as unknown[],
    violations: Reflect.get(window, 'resourceCspViolations') as string[],
  }));
}
