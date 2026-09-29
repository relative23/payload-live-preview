/**
 * ADR 0022: `subfieldCoverage` is a client option as well as an inline slot.
 * An option the client does not forward leaves the runtime on its default, and
 * the page keeps hiding an edit of an unbound sibling without a word.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LivePreviewClient } from '@client/index';
import { fireUpdate, preparePreviewPage, restorePreviewPage, v1Config } from './client-harness';

beforeEach(preparePreviewPage);
afterEach(restorePreviewPage);

const GROUP = '<p data-payload-field="hero.eyebrow">E</p>';

async function unboundAfterSiblingEdit(client: LivePreviewClient): Promise<readonly string[]> {
  await fireUpdate({ hero: { eyebrow: 'E', description: 'D' } });
  await fireUpdate({ hero: { eyebrow: 'E', description: 'D2' } });
  return client.inspect().fidelity.fields;
}

describe('LivePreviewClient — subfieldCoverage', () => {
  it("reports an edited unbound sibling under 'declared'", async () => {
    document.body.innerHTML = GROUP;
    const client = new LivePreviewClient(v1Config({ subfieldCoverage: 'declared' }));
    try {
      expect(await unboundAfterSiblingEdit(client)).toContain('hero.description');
    } finally {
      await client.destroy();
    }
  });

  it('keeps the descendant rule when the option is not given', async () => {
    document.body.innerHTML = GROUP;
    const client = new LivePreviewClient(v1Config());
    try {
      expect(await unboundAfterSiblingEdit(client)).not.toContain('hero.description');
    } finally {
      await client.destroy();
    }
  });
});
