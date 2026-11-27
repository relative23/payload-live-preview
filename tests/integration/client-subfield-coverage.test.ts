/**
 * ADR 0022: `subfieldCoverage` is a client option as well as an inline slot.
 * An option the client does not forward leaves the runtime on its default, and
 * the page keeps hiding an edit of an unbound sibling without a word.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LivePreviewClient } from '@client/index';
import {
  fireUpdate,
  preparePreviewPage,
  restorePreviewPage,
  pipelineConfig,
} from './client-harness';

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
    const client = new LivePreviewClient(pipelineConfig({ subfieldCoverage: 'declared' }));
    try {
      expect(await unboundAfterSiblingEdit(client)).toContain('hero.description');
    } finally {
      await client.destroy();
    }
  });

  it('reports it as well when the option is not given (ADR 0007, row 17)', async () => {
    document.body.innerHTML = GROUP;
    const client = new LivePreviewClient(pipelineConfig());
    try {
      expect(await unboundAfterSiblingEdit(client)).toContain('hero.description');
    } finally {
      await client.destroy();
    }
  });

  it("keeps the 2.x rule under 'descendant': the bound sibling covers the group", async () => {
    document.body.innerHTML = GROUP;
    const client = new LivePreviewClient(pipelineConfig({ subfieldCoverage: 'descendant' }));
    try {
      expect(await unboundAfterSiblingEdit(client)).not.toContain('hero.description');
    } finally {
      await client.destroy();
    }
  });
});
