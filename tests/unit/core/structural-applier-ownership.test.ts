import { describe, expect, it, vi } from 'vitest';
import { applyStructuralPatches } from '@core/structural-applier';
import { diffArray } from '@schema/diff';
import { store } from './structural-applier-harness';

describe('applyStructuralPatches — document ownership', () => {
  it('parses rendered roots with the container ownerDocument', () => {
    const targetDocument = document.implementation.createHTMLDocument('structural target');
    const createElement = vi.spyOn(targetDocument, 'createElement');
    const container = targetDocument.createElement('ul');
    createElement.mockClear();

    try {
      const next = [{ id: 'target', label: 'Owned' }];
      expect(
        applyStructuralPatches({
          store,
          template: '<li>{{label}}</li>',
          container,
          patches: diffArray([], next),
          nextItems: next,
        }),
      ).toBe(true);

      expect(createElement).toHaveBeenCalledWith('template');
      expect(container.firstElementChild?.ownerDocument).toBe(targetDocument);
    } finally {
      createElement.mockRestore();
    }
  });
});
