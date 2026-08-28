import { describe, expect, it, vi } from 'vitest';
import type { LivePreviewPlugin } from '@plugins/types';
import { deferred, makeManager, settlesWithinMicrotaskDrain } from './helpers';

describe('PluginManager — mutation queue and pending hooks', () => {
  it('serializes registration, removal, and re-registration mutations', async () => {
    const { manager } = makeManager();
    const initGate = deferred();
    const initStarted = deferred();
    const calls: string[] = [];
    const first: LivePreviewPlugin = {
      name: 'serial',
      init: async () => {
        calls.push('first:init:start');
        initStarted.resolve();
        await initGate.promise;
        calls.push('first:init:end');
      },
      destroy: () => {
        calls.push('first:destroy');
      },
    };
    const second: LivePreviewPlugin = {
      name: 'serial',
      init: () => {
        calls.push('second:init');
      },
    };

    const registerFirst = manager.register(first);
    const removeFirst = manager.unregister(first.name);
    const registerSecond = manager.register(second);
    await initStarted.promise;
    expect(calls).toEqual(['first:init:start']);
    initGate.resolve();
    await Promise.all([registerFirst, removeFirst, registerSecond]);

    expect(calls).toEqual(['first:init:start', 'first:init:end', 'first:destroy', 'second:init']);
    expect(manager.list()).toEqual(['serial']);
  });

  it('lets init await removal of its own pending registration without deadlocking', async () => {
    const { manager } = makeManager();
    const initStarted = deferred();
    let selfRemoval: Promise<void> | undefined;
    let resumed = false;
    const registration = manager.register({
      name: 'self-removing-init',
      init: async () => {
        initStarted.resolve();
        selfRemoval = manager.unregister('self-removing-init');
        await selfRemoval;
        resumed = true;
      },
    });
    await initStarted.promise;
    if (selfRemoval === undefined) throw new Error('self-removal was not started');

    expect(await settlesWithinMicrotaskDrain(selfRemoval)).toBe(true);
    await registration;
    expect(resumed).toBe(true);
    expect(manager.list()).toEqual([]);
  });

  it('lets init await registration of another plugin without deadlocking', async () => {
    const { manager } = makeManager();
    const initStarted = deferred();
    const calls: string[] = [];
    let nestedRegistration: Promise<void> | undefined;
    const registration = manager.register({
      name: 'registering-init',
      init: async () => {
        calls.push('parent:start');
        nestedRegistration = manager.register({
          name: 'nested-from-init',
          init: () => {
            calls.push('nested:init');
          },
        });
        initStarted.resolve();
        await nestedRegistration;
        calls.push('parent:end');
      },
    });
    await initStarted.promise;
    if (nestedRegistration === undefined) throw new Error('nested registration was not started');

    expect(await settlesWithinMicrotaskDrain(nestedRegistration)).toBe(true);
    await registration;
    expect(calls).toEqual(['parent:start', 'nested:init', 'parent:end']);
    expect(manager.list()).toEqual(['nested-from-init', 'registering-init']);
  });

  it('lets an external removal cancel a pending async init without rejecting', async () => {
    const { manager, events } = makeManager();
    const initStarted = deferred();
    const releaseInit = deferred();
    const listener = vi.fn();
    const registration = manager.register({
      name: 'externally-cancelled-init',
      init: async (ctx) => {
        ctx.events.on('documentSave', listener);
        initStarted.resolve();
        await releaseInit.promise;
      },
    });
    await initStarted.promise;

    const removal = manager.unregister('externally-cancelled-init');
    expect(await settlesWithinMicrotaskDrain(removal)).toBe(true);
    await expect(removal).resolves.toBeUndefined();
    releaseInit.resolve();
    await registration;
    await events.emit('documentSave', { timestamp: 1 });

    expect(listener).not.toHaveBeenCalled();
    expect(manager.list()).toEqual([]);
  });

  it('lets a destroy hook await removal of another plugin without deadlocking', async () => {
    const { manager } = makeManager();
    const destroyStarted = deferred();
    const calls: string[] = [];
    let nestedRemoval: Promise<void> | undefined;
    await manager.register({
      name: 'destroy-a',
      init: () => undefined,
      destroy: async () => {
        calls.push('a:start');
        nestedRemoval = manager.unregister('destroy-b');
        destroyStarted.resolve();
        await nestedRemoval;
        calls.push('a:end');
      },
    });
    await manager.register({
      name: 'destroy-b',
      init: () => undefined,
      destroy: () => {
        calls.push('b');
      },
    });

    const removal = manager.unregister('destroy-a');
    await destroyStarted.promise;
    if (nestedRemoval === undefined) throw new Error('nested removal was not started');
    expect(await settlesWithinMicrotaskDrain(nestedRemoval)).toBe(true);
    await removal;

    expect(calls).toEqual(['a:start', 'b', 'a:end']);
    expect(manager.list()).toEqual([]);
  });

  it('lets a destroy hook await registration of another plugin without deadlocking', async () => {
    const { manager } = makeManager();
    const destroyStarted = deferred();
    const calls: string[] = [];
    let nestedRegistration: Promise<void> | undefined;
    await manager.register({
      name: 'registering-destroy',
      init: () => undefined,
      destroy: async () => {
        calls.push('destroy:start');
        nestedRegistration = manager.register({
          name: 'nested-from-destroy',
          init: () => {
            calls.push('nested:init');
          },
        });
        destroyStarted.resolve();
        await nestedRegistration;
        calls.push('destroy:end');
      },
    });

    const removal = manager.unregister('registering-destroy');
    await destroyStarted.promise;
    if (nestedRegistration === undefined) throw new Error('nested registration was not started');
    expect(await settlesWithinMicrotaskDrain(nestedRegistration)).toBe(true);
    await removal;

    expect(calls).toEqual(['destroy:start', 'nested:init', 'destroy:end']);
    expect(manager.list()).toEqual(['nested-from-destroy']);
  });

  it('lets a destroy hook await redundant removal of itself without deadlocking', async () => {
    const { manager } = makeManager();
    const selfRemovalStarted = deferred();
    let nestedRemoval: Promise<void> | undefined;
    await manager.register({
      name: 'self-removing-destroy',
      init: () => undefined,
      destroy: async () => {
        await Promise.resolve();
        nestedRemoval = manager.unregister('self-removing-destroy');
        selfRemovalStarted.resolve();
        await nestedRemoval;
      },
    });

    const removal = manager.unregister('self-removing-destroy');
    await selfRemovalStarted.promise;
    if (nestedRemoval === undefined) throw new Error('nested self-removal was not started');

    expect(await settlesWithinMicrotaskDrain(nestedRemoval)).toBe(true);
    await expect(removal).resolves.toBeUndefined();
    expect(manager.list()).toEqual([]);
  });

  it('deduplicates removal promises before the target destroy hook starts', async () => {
    const { manager } = makeManager();
    const releaseInit = deferred();
    const initStarted = deferred();
    const releaseDestroy = deferred();
    await manager.register({
      name: 'duplicate-removal-target',
      init: () => undefined,
      destroy: async () => releaseDestroy.promise,
    });
    const blocker = manager.register({
      name: 'pending-unrelated-init',
      init: async () => {
        initStarted.resolve();
        await releaseInit.promise;
      },
    });
    await initStarted.promise;

    const first = manager.unregister('duplicate-removal-target');
    const second = manager.unregister('duplicate-removal-target');

    expect(second).toBe(first);
    expect(await settlesWithinMicrotaskDrain(first)).toBe(false);
    releaseDestroy.resolve();
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
    releaseInit.resolve();
    await blocker;
    await manager.unregister('pending-unrelated-init');
  });

  it('keeps a plugin name occupied until its pending teardown completes', async () => {
    const { manager } = makeManager();
    const releaseDestroy = deferred();
    const destroyStarted = deferred();
    const replacementInit = vi.fn();
    let replacementRegistration: Promise<void> | undefined;

    await manager.register({
      name: 'same-name-during-destroy',
      init: () => undefined,
      destroy: async () => {
        replacementRegistration = manager.register({
          name: 'same-name-during-destroy',
          init: replacementInit,
        });
        destroyStarted.resolve();
        await releaseDestroy.promise;
      },
    });

    const removal = manager.unregister('same-name-during-destroy');
    await destroyStarted.promise;
    if (replacementRegistration === undefined) {
      throw new Error('same-name replacement registration was not started');
    }
    expect(await settlesWithinMicrotaskDrain(replacementRegistration)).toBe(true);

    releaseDestroy.resolve();
    await Promise.all([removal, replacementRegistration]);

    expect(replacementInit).not.toHaveBeenCalled();
    expect(manager.list()).toEqual([]);
  });

  it('continues destroyAll after nested removal and a throwing destroy hook', async () => {
    const { manager } = makeManager();
    const destroyStarted = deferred();
    const calls: string[] = [];
    let nestedRemoval: Promise<void> | undefined;
    await manager.register({
      name: 'bulk-a',
      init: () => undefined,
      destroy: async () => {
        calls.push('a:start');
        nestedRemoval = manager.unregister('bulk-b');
        destroyStarted.resolve();
        await nestedRemoval;
        calls.push('a:end');
      },
    });
    await manager.register({
      name: 'bulk-b',
      init: () => undefined,
      destroy: () => {
        calls.push('b');
        throw new Error('nested destroy failed');
      },
    });
    await manager.register({
      name: 'bulk-c',
      init: () => undefined,
      destroy: () => {
        calls.push('c');
      },
    });

    const destruction = manager.destroyAll();
    await destroyStarted.promise;
    if (nestedRemoval === undefined) throw new Error('nested removal was not started');
    expect(await settlesWithinMicrotaskDrain(nestedRemoval)).toBe(true);
    await destruction;

    expect(calls).toEqual(['a:start', 'b', 'a:end', 'c']);
    expect(manager.list()).toEqual([]);
  });

  it('lets init await destroyAll and prevents its staged scope from committing', async () => {
    const { manager, events } = makeManager();
    const existingDestroy = vi.fn();
    const stagedListener = vi.fn();
    let nestedDestruction: Promise<void> | undefined;
    await manager.register({
      name: 'existing-before-bulk-init',
      init: () => undefined,
      destroy: existingDestroy,
    });

    const registration = manager.register({
      name: 'bulk-during-init',
      init: async (ctx) => {
        ctx.events.on('documentSave', stagedListener);
        nestedDestruction = manager.destroyAll();
        await nestedDestruction;
      },
    });
    await registration;
    if (nestedDestruction === undefined) throw new Error('nested destroyAll was not started');
    await nestedDestruction;
    await events.emit('documentSave', { timestamp: 1 });

    expect(existingDestroy).toHaveBeenCalledOnce();
    expect(stagedListener).not.toHaveBeenCalled();
    expect(manager.list()).toEqual([]);
  });
});

describe('PluginManager — only a queue-held hook opens the direct path', () => {
  it('serializes later mutations while a direct-path init is still pending', async () => {
    const { manager } = makeManager();
    const calls: string[] = [];
    const queuedGate = deferred();
    const queuedStarted = deferred();
    const directGate = deferred();
    const laterGate = deferred();

    const queued = manager.register({
      name: 'queued',
      init: async () => {
        queuedStarted.resolve();
        await queuedGate.promise;
      },
    });
    await queuedStarted.promise;
    // Arrives while the queued hook is pending: takes the direct path and stays pending.
    const direct = manager.register({
      name: 'direct',
      init: async () => {
        await directGate.promise;
      },
    });
    queuedGate.resolve();
    await queued;

    // The queue is idle; only the direct-path hook is pending. These two must serialize.
    const later = manager.register({
      name: 'later',
      init: async () => {
        calls.push('later:start');
        await laterGate.promise;
        calls.push('later:end');
      },
    });
    const last = manager.register({
      name: 'last',
      init: () => {
        calls.push('last');
      },
    });
    expect(await settlesWithinMicrotaskDrain(last)).toBe(false);
    expect(calls).toEqual(['later:start']);

    laterGate.resolve();
    await Promise.all([later, last]);
    expect(calls).toEqual(['later:start', 'later:end', 'last']);

    directGate.resolve();
    await direct;
    expect(manager.list()).toEqual(['queued', 'later', 'last', 'direct']);
  });

  it('holds the queue while waiting on a teardown started on the direct path', async () => {
    const { manager } = makeManager();
    const queuedGate = deferred();
    const queuedStarted = deferred();
    const destroyGate = deferred();
    let nested: Promise<void> | undefined;
    await manager.register({
      name: 'victim',
      init: () => undefined,
      destroy: async () => {
        await destroyGate.promise;
        nested = manager.register({ name: 'from-destroy', init: () => undefined });
        await nested;
      },
    });

    const queued = manager.register({
      name: 'queued',
      init: async () => {
        queuedStarted.resolve();
        await queuedGate.promise;
      },
    });
    await queuedStarted.promise;
    const directRemoval = manager.unregister('victim');
    queuedGate.resolve();
    await queued;

    // Queued now: it must wait for the pending teardown without deadlocking its nested registration.
    const queuedRemoval = manager.unregister('victim');
    destroyGate.resolve();
    await Promise.all([directRemoval, queuedRemoval]);
    if (nested === undefined) throw new Error('nested registration was not started');
    await nested;

    expect(manager.list()).toEqual(['queued', 'from-destroy']);
  });

  it('keeps the queue usable when a mutation escapes with an error', async () => {
    const { manager, logs } = makeManager();
    // Reading the name is the first thing `register` does, before it owns any
    // error handling of its own, so this failure escapes the whole operation.
    const hostile = {
      get name(): string {
        throw new Error('name exploded');
      },
    } as LivePreviewPlugin;

    await expect(manager.register(hostile)).rejects.toThrow('name exploded');
    expect(logs.some((entry) => entry.join(' ').includes('mutation failed'))).toBe(true);

    // The tail is not poisoned: an ordinary registration still goes through.
    await manager.register({ name: 'after', init: () => undefined });
    expect(manager.list()).toEqual(['after']);
  });
});
