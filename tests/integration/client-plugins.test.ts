import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LivePreviewClient } from '@client/index';
import {
  deferred,
  fireMessage,
  fireUpdate,
  preparePreviewPage,
  restorePreviewPage,
  settlesWithinMicrotaskDrain,
  v1Config,
} from './client-harness';

beforeEach(preparePreviewPage);
afterEach(restorePreviewPage);

describe('LivePreviewClient — renderers from plugins', () => {
  it('ignores a custom renderer false return after a real DOM write', async () => {
    document.body.innerHTML = '<div data-payload-field="value" data-payload-type="text"></div>';
    const client = new LivePreviewClient(v1Config());
    await client.use({
      name: 'boolean-returning-renderer',
      init: (context) => {
        context.registerFieldRenderer({
          name: 'text',
          // toggleAttribute returns false while removing a present attribute; the void contract ignores it.
          render: (target) => target.element.toggleAttribute('data-before', false),
        });
      },
    });
    const element = document.querySelector('[data-payload-field="value"]');
    if (element === null) throw new Error('binding missing');
    element.setAttribute('data-before', '');
    const elementUpdate = vi.fn();
    const afterUpdate = vi.fn();
    client.events.on('elementUpdate', elementUpdate);
    client.events.on('afterUpdate', afterUpdate);

    try {
      await fireUpdate({ value: 'applied' });

      expect(element.hasAttribute('data-before')).toBe(false);
      expect(elementUpdate).toHaveBeenCalledOnce();
      expect(afterUpdate).toHaveBeenCalledWith(expect.objectContaining({ updatedCount: 1 }));
    } finally {
      await client.destroy();
    }
  });

  it('honours a plugin renderer override', async () => {
    document.body.innerHTML = '<p data-payload-field="title">old</p>';
    const client = new LivePreviewClient(v1Config());
    await client.use({
      name: 'upper',
      init: (ctx) => {
        ctx.registerFieldRenderer({
          name: 'text',
          render: (target, value) => {
            target.element.textContent = String(value).toUpperCase();
          },
        });
      },
    });
    fireMessage({ type: 'payload-live-preview', data: { title: 'hello' } });
    await vi.advanceTimersByTimeAsync(50);
    expect(document.querySelector('p')?.textContent).toBe('HELLO');
    await client.destroy();
  });

  it('restores the previous renderer layer and then the built-in renderer on unuse', async () => {
    document.body.innerHTML = '<p data-payload-field="title">old</p>';
    const client = new LivePreviewClient(v1Config());
    try {
      await client.use({
        name: 'renderer-a',
        init: (ctx) => {
          ctx.registerFieldRenderer({
            name: 'text',
            render: (target, value) => {
              target.element.textContent = `A:${String(value)}`;
            },
          });
        },
      });
      await client.use({
        name: 'renderer-b',
        init: (ctx) => {
          ctx.registerFieldRenderer({
            name: 'text',
            render: (target, value) => {
              target.element.textContent = `B:${String(value)}`;
            },
          });
        },
      });

      await fireUpdate({ title: 'first' });
      expect(document.querySelector('p')?.textContent).toBe('B:first');

      await client.unuse('renderer-b');
      await fireUpdate({ title: 'second' });
      expect(document.querySelector('p')?.textContent).toBe('A:second');

      await client.unuse('renderer-a');
      await fireUpdate({ title: 'third' });
      expect(document.querySelector('p')?.textContent).toBe('third');
    } finally {
      await client.destroy();
    }
  });

  it('keeps the top renderer active when a lower renderer layer is removed', async () => {
    document.body.innerHTML = '<p data-payload-field="title">old</p>';
    const client = new LivePreviewClient(v1Config());
    try {
      await client.use({
        name: 'lower-renderer',
        init: (ctx) => {
          ctx.registerFieldRenderer({
            name: 'text',
            render: (target, value) => {
              target.element.textContent = `lower:${String(value)}`;
            },
          });
        },
      });
      await client.use({
        name: 'top-renderer',
        init: (ctx) => {
          ctx.registerFieldRenderer({
            name: 'text',
            render: (target, value) => {
              target.element.textContent = `top:${String(value)}`;
            },
          });
        },
      });

      await client.unuse('lower-renderer');
      await fireUpdate({ title: 'still top' });
      expect(document.querySelector('p')?.textContent).toBe('top:still top');

      await client.unuse('top-renderer');
      await fireUpdate({ title: 'built in' });
      expect(document.querySelector('p')?.textContent).toBe('built in');
    } finally {
      await client.destroy();
    }
  });
});

describe('LivePreviewClient — nested use and unuse from plugin hooks', () => {
  it('lets a plugin destroy hook await client.unuse for another plugin', async () => {
    const client = new LivePreviewClient(v1Config());
    const destroyStarted = deferred<undefined>();
    const calls: string[] = [];
    let nestedRemoval: Promise<void> | undefined;
    await client.use({
      name: 'client-destroy-a',
      init: () => undefined,
      destroy: async () => {
        calls.push('a:start');
        nestedRemoval = client.unuse('client-destroy-b');
        destroyStarted.resolve(undefined);
        await nestedRemoval;
        calls.push('a:end');
      },
    });
    await client.use({
      name: 'client-destroy-b',
      init: () => undefined,
      destroy: () => {
        calls.push('b');
      },
    });

    const destruction = client.destroy();
    await destroyStarted.promise;
    if (nestedRemoval === undefined) throw new Error('nested client.unuse was not started');
    expect(await settlesWithinMicrotaskDrain(nestedRemoval)).toBe(true);
    await destruction;

    expect(calls).toEqual(['a:start', 'b', 'a:end']);
    expect(client.plugins).toEqual([]);
  });

  it('lets plugin init await client.unuse for its own pending registration', async () => {
    const client = new LivePreviewClient(v1Config());
    const initStarted = deferred<undefined>();
    let selfRemoval: Promise<void> | undefined;
    const registration = client.use({
      name: 'client-self-removing-init',
      init: async () => {
        selfRemoval = client.unuse('client-self-removing-init');
        initStarted.resolve(undefined);
        await selfRemoval;
      },
    });
    await initStarted.promise;
    if (selfRemoval === undefined) throw new Error('self-removing client.unuse was not started');

    expect(await settlesWithinMicrotaskDrain(selfRemoval)).toBe(true);
    await registration;
    expect(client.plugins).toEqual([]);
    await client.destroy();
  });

  it('lets plugin init await client.use for another plugin', async () => {
    const client = new LivePreviewClient(v1Config());
    const initStarted = deferred<undefined>();
    let nestedUse: Promise<void> | undefined;
    const registration = client.use({
      name: 'client-registering-init',
      init: async () => {
        nestedUse = client.use({ name: 'client-nested-init', init: () => undefined });
        initStarted.resolve(undefined);
        await nestedUse;
      },
    });
    await initStarted.promise;
    if (nestedUse === undefined) throw new Error('nested client.use was not started');

    expect(await settlesWithinMicrotaskDrain(nestedUse)).toBe(true);
    await registration;
    expect(client.plugins).toEqual(['client-nested-init', 'client-registering-init']);
    await client.destroy();
  });

  it('lets plugin destroy await client.use for another plugin during unuse', async () => {
    const client = new LivePreviewClient(v1Config());
    const destroyStarted = deferred<undefined>();
    let nestedUse: Promise<void> | undefined;
    await client.use({
      name: 'client-registering-destroy',
      init: () => undefined,
      destroy: async () => {
        nestedUse = client.use({ name: 'client-nested-destroy', init: () => undefined });
        destroyStarted.resolve(undefined);
        await nestedUse;
      },
    });

    const removal = client.unuse('client-registering-destroy');
    await destroyStarted.promise;
    if (nestedUse === undefined) throw new Error('nested client.use was not started');
    expect(await settlesWithinMicrotaskDrain(nestedUse)).toBe(true);
    await removal;

    expect(client.plugins).toEqual(['client-nested-destroy']);
    await client.destroy();
  });
});
