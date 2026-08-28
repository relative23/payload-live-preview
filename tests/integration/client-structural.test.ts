import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LivePreviewClient } from '@client/index';
import { fireUpdate, preparePreviewPage, restorePreviewPage, v1Config } from './client-harness';

beforeEach(preparePreviewPage);
afterEach(restorePreviewPage);

describe('LivePreviewClient — structural updates and no-ops', () => {
  it('applies structural updates before afterUpdate and never defers DOM work past destroy', async () => {
    document.body.innerHTML =
      '<ul data-payload-field="items" data-payload-structural ' +
      'data-payload-array-template="<li>{{label}}</li>"></ul>';
    let transitionWork: (() => void) | undefined;
    const startViewTransition = vi.fn((work: () => void) => {
      transitionWork = work;
      return { finished: Promise.resolve() };
    });
    Reflect.set(document, 'startViewTransition', startViewTransition);
    const client = new LivePreviewClient(v1Config());
    let domAtAfterUpdate: string | undefined;
    client.events.on('afterUpdate', () => {
      domAtAfterUpdate = document.querySelector('ul')?.textContent ?? undefined;
    });

    try {
      await fireUpdate({ items: [{ id: 'a', label: 'applied' }] });

      expect(document.querySelector('ul')?.textContent).toBe('applied');
      expect(domAtAfterUpdate).toBe('applied');
      expect(startViewTransition).not.toHaveBeenCalled();
      expect(transitionWork).toBeUndefined();
      await client.destroy();
      const container = document.querySelector('ul');
      if (container === null) throw new Error('structural container missing');
      container.replaceChildren(document.createTextNode('consumer state after destroy'));

      expect(transitionWork).toBeUndefined();
      expect(container.textContent).toBe('consumer state after destroy');
    } finally {
      Reflect.deleteProperty(document, 'startViewTransition');
      await client.destroy();
    }
  });

  it.each([
    ['missing template', ''],
    [
      'sanitized template without an element root',
      ' data-payload-array-template="<script>{{label}}</script>"',
    ],
  ])('does not emit afterUpdate for a structural %s no-op', async (_label, templateAttribute) => {
    document.body.innerHTML = `<ul data-payload-field="items" data-payload-structural${templateAttribute}></ul>`;
    const client = new LivePreviewClient(v1Config());
    const afterUpdate = vi.fn();
    client.events.on('afterUpdate', afterUpdate);

    try {
      await fireUpdate({ items: [{ id: 'a', label: 'not applied' }] });

      expect(document.querySelector('ul')?.children).toHaveLength(0);
      expect(afterUpdate).not.toHaveBeenCalled();
    } finally {
      await client.destroy();
    }
  });

  it('keeps existing structural DOM intact when a changed item has no renderable root', async () => {
    document.body.innerHTML =
      '<ul data-payload-field="items" data-payload-structural ' +
      'data-payload-array-template="<script>{{label}}</script>">' +
      '<li data-payload-key="old">server state</li></ul>';
    const client = new LivePreviewClient(v1Config());
    const afterUpdate = vi.fn();
    client.events.on('afterUpdate', afterUpdate);

    try {
      await fireUpdate({ items: [{ id: 'new', label: 'cannot render' }] });

      const container = document.querySelector('ul');
      expect(container?.children).toHaveLength(1);
      expect(container?.firstElementChild?.getAttribute('data-payload-key')).toBe('old');
      expect(container?.textContent).toBe('server state');
      expect(afterUpdate).not.toHaveBeenCalled();
    } finally {
      await client.destroy();
    }
  });

  it('does not emit another afterUpdate for unchanged structural DOM', async () => {
    document.body.innerHTML =
      '<ul data-payload-field="items" data-payload-structural ' +
      'data-payload-array-template="<li>{{label}}</li>"></ul>';
    const client = new LivePreviewClient(v1Config());
    const afterUpdate = vi.fn();
    client.events.on('afterUpdate', afterUpdate);
    const items = [{ id: 'a', label: 'applied once' }];

    try {
      await fireUpdate({ items });
      expect(afterUpdate).toHaveBeenCalledOnce();
      afterUpdate.mockClear();

      await fireUpdate({ items: [{ id: 'a', label: 'applied once' }] });

      expect(document.querySelector('ul')?.textContent).toBe('applied once');
      expect(afterUpdate).not.toHaveBeenCalled();
    } finally {
      await client.destroy();
    }
  });

  it.each([
    {
      label: 'text renderer protecting structured children',
      markup: '<div data-payload-field="value" data-payload-type="text"><span>seed</span></div>',
      value: 'replacement',
    },
    {
      label: 'array renderer receiving a non-array value',
      markup: '<div data-payload-field="value" data-payload-type="array">seed</div>',
      value: 'not an array',
    },
    {
      label: 'rich-text renderer receiving an unsupported value',
      markup: '<div data-payload-field="value" data-payload-type="richText">seed</div>',
      value: { unsupported: true },
    },
  ])('does not emit afterUpdate for $label', async ({ markup, value }) => {
    document.body.innerHTML = markup;
    const client = new LivePreviewClient(v1Config());
    const afterUpdate = vi.fn();
    client.events.on('afterUpdate', afterUpdate);

    try {
      await fireUpdate({ value });

      expect(afterUpdate).not.toHaveBeenCalled();
    } finally {
      await client.destroy();
    }
  });

  it.each([
    ['image', { url: 'javascript:alert(1)' }],
    ['upload', { url: 'javascript:alert(1)', filename: 'unsafe' }],
  ])(
    'the %s renderer clears the stale src for an unsafe URL and reports that write',
    async (type, value) => {
      document.body.innerHTML = `<img data-payload-field="value" data-payload-type="${type}" src="/before.jpg">`;
      const client = new LivePreviewClient(v1Config());
      const afterUpdate = vi.fn();
      client.events.on('afterUpdate', afterUpdate);

      try {
        await fireUpdate({ value });

        // Leaving the previous src would keep showing a document the editor replaced.
        expect(document.querySelector('img')?.getAttribute('src')).toBeNull();
        expect(afterUpdate).toHaveBeenCalledOnce();
      } finally {
        await client.destroy();
      }
    },
  );
});
