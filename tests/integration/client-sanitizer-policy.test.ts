/**
 * ADR 0002: the sanitizer policy is instance state. Before it was, the client
 * constructed last set a module default that every client then sanitised with.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LivePreviewClient } from '@client/index';
import { sanitizeHtml, setSanitizerPolicy } from '@security/sanitizer';
import { fireUpdate, preparePreviewPage, restorePreviewPage, v1Config } from './client-harness';

beforeEach(() => {
  preparePreviewPage();
  setSanitizerPolicy('strict');
});
afterEach(() => {
  restorePreviewPage();
  setSanitizerPolicy('strict');
});

// `id` passes under compat and is stripped under strict.
const CLOBBER = '<p id="hero">t</p>';
const STRIPPED = '<p>t</p>';

/** Two roots on one page with one binding each, so each client renders its own copy of the field. */
function mountRoots(type: string): [Element, Element] {
  const binding = `<div data-payload-field="body" data-payload-type="${type}"></div>`;
  document.body.innerHTML = `<section id="a">${binding}</section><section id="b">${binding}</section>`;
  return [document.getElementById('a')!, document.getElementById('b')!];
}

function rendered(root: Element): string {
  return root.firstElementChild?.innerHTML ?? '';
}

describe('LivePreviewClient — sanitizer policy per instance', () => {
  it("a v1 client without a policy of its own sanitises compat, as defaults: 'v1' promises", async () => {
    // The runtime's own fallback is strict since the 2.0 flip; the profile has
    // to fill the row, or opting out of 2.0 would still sanitise like 2.0.
    const [a] = mountRoots('html');
    const client = new LivePreviewClient(v1Config({ root: a }));
    try {
      await fireUpdate({ body: CLOBBER });
      expect(rendered(a)).toBe(CLOBBER);
    } finally {
      await client.destroy();
    }
  });

  it.each([['html'], ['richText']] as const)(
    '%s: each client sanitises with its own policy',
    async (type) => {
      const [a, b] = mountRoots(type);
      const compat = new LivePreviewClient(v1Config({ root: a, sanitizerPolicy: 'compat' }));
      const strict = new LivePreviewClient(v1Config({ root: b, sanitizerPolicy: 'strict' }));
      try {
        await fireUpdate({ body: CLOBBER });
        expect(rendered(a)).toBe(CLOBBER);
        expect(rendered(b)).toBe(STRIPPED);
      } finally {
        await compat.destroy();
        await strict.destroy();
      }
    },
  );

  it('constructing a second client does not change the first', async () => {
    const [a, b] = mountRoots('html');
    const compat = new LivePreviewClient(v1Config({ root: a, sanitizerPolicy: 'compat' }));
    let strict: LivePreviewClient | undefined;
    try {
      await fireUpdate({ body: CLOBBER });
      expect(rendered(a)).toBe(CLOBBER);
      strict = new LivePreviewClient(v1Config({ root: b, sanitizerPolicy: 'strict' }));
      await fireUpdate({ body: '<p id="hero">again</p>' });
      expect(rendered(a)).toBe('<p id="hero">again</p>');
      expect(rendered(b)).toBe('<p>again</p>');
    } finally {
      await compat.destroy();
      await strict?.destroy();
    }
  });

  it('leaves the process default alone for direct sanitizeHtml() callers', async () => {
    const [a] = mountRoots('html');
    const compat = new LivePreviewClient(v1Config({ root: a, sanitizerPolicy: 'compat' }));
    try {
      await fireUpdate({ body: CLOBBER });
      expect(rendered(a)).toBe(CLOBBER);
      expect(sanitizeHtml(CLOBBER)).toBe(STRIPPED);
    } finally {
      await compat.destroy();
    }
  });
});
