/**
 * Execute the actual application store template, not a historical copy of it.
 * These finite lifetime checks supplement native React commit tests; JSDOM
 * neither hydrates React nor proves Astro's event order.
 */
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface Snapshot {
  title: string;
  show: boolean;
  revision: number;
  delayed: boolean;
}
interface Store {
  readIslandSnapshot: (island: Element) => Snapshot | undefined;
  subscribeIslandSnapshot: (island: Element, listener: (value: Snapshot) => void) => () => void;
  mountIslandSnapshots: (root: HTMLElement, id: number, locale: string) => () => void;
}
const code = transpileModule(
  readFileSync('tests/fixtures/astro-react-owned/src/client/island-snapshots.ts.fixture', 'utf8'),
  { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } },
).outputText;
let store: Store;
let stops: (() => void)[];

function owner(id = 41, locale = 'de') {
  const root = document.createElement('plp-astro-preview');
  root.innerHTML = '<astro-island></astro-island><astro-island></astro-island>';
  document.body.append(root);
  const islands = [...root.querySelectorAll('astro-island')];
  const stop = store.mountIslandSnapshots(root, id, locale);
  stops.push(stop);
  return { root, islands, stop };
}
function send(island: Element, revision: number, fields = {}, locale = 'de') {
  island.dispatchEvent(
    new CustomEvent('payload-live-preview:update', {
      detail: { fields: { id: 41, title: 'unsaved', show: true, ...fields }, locale, revision },
    }),
  );
}

beforeEach(() => {
  const module = { exports: {} as Store };
  runInNewContext(code, { exports: module.exports, module, AbortController });
  store = module.exports;
  stops = [];
});
afterEach(() => {
  for (const stop of stops) stop();
  document.body.replaceChildren();
});

describe('finite page-owned island snapshot handoff', () => {
  it('retains only the latest selected immutable presentation until React subscribes', () => {
    const { islands } = owner();
    send(islands[0]!, 1, { title: 'older' });
    send(islands[0]!, 2, {
      title: 'latest 🦊',
      ownerDelayMs: 1000,
      authority: { subject: 'not-authority' },
      module: '/untrusted.js',
      resource: '/untrusted.css',
    });
    const receive = vi.fn();
    const unsubscribe = store.subscribeIslandSnapshot(islands[0]!, receive);
    const latest = store.readIslandSnapshot(islands[0]!);
    expect(latest).toEqual({ title: 'latest 🦊', show: true, revision: 2, delayed: true });
    expect(Object.isFrozen(latest)).toBe(true);
    expect(receive).not.toHaveBeenCalled();
    expect(store.readIslandSnapshot(islands[1]!)).toBeUndefined();
    send(islands[0]!, 3);
    expect(receive).toHaveBeenCalledExactlyOnceWith(store.readIslandSnapshot(islands[0]!));
    unsubscribe();
    send(islands[0]!, 4);
    expect(receive).toHaveBeenCalledTimes(1);
  });

  it.each([0, -1, 1, 2, 2.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'does not replay stale, duplicate or invalid revision %s',
    (revision) => {
      const { islands } = owner();
      const receive = vi.fn();
      store.subscribeIslandSnapshot(islands[0]!, receive);
      send(islands[0]!, 2);
      const latest = store.readIslandSnapshot(islands[0]!);
      send(islands[0]!, revision, { title: 'wrong' });
      expect(store.readIslandSnapshot(islands[0]!)).toBe(latest);
      expect(receive).toHaveBeenCalledTimes(1);
    },
  );

  it('keeps document, locale and island channels independent', () => {
    const first = owner();
    const second = owner(42, 'en');
    send(first.islands[0]!, 1, { id: 42 });
    send(first.islands[0]!, 1, {}, 'en');
    expect(store.readIslandSnapshot(first.islands[0]!)).toBeUndefined();
    send(first.islands[0]!, 1, { title: 'first' });
    send(first.islands[1]!, 1, { title: 'sibling' });
    send(second.islands[0]!, 1, { id: 42, title: 'other' }, 'en');
    expect(store.readIslandSnapshot(first.islands[0]!)?.title).toBe('first');
    expect(store.readIslandSnapshot(first.islands[1]!)?.title).toBe('sibling');
    expect(store.readIslandSnapshot(second.islands[0]!)?.title).toBe('other');
  });

  it('normalizes unselected presentation values without retaining arbitrary data', () => {
    const { islands } = owner();
    send(islands[0]!, 1, { title: {}, show: 'true', ownerDelayMs: 999 });
    expect(store.readIslandSnapshot(islands[0]!)).toEqual({
      title: '',
      show: false,
      revision: 1,
      delayed: false,
    });
  });

  it('clears state and removes ingress when stopped, then accepts a fresh revision epoch', () => {
    const { root, islands, stop } = owner();
    const receive = vi.fn();
    const unsubscribe = store.subscribeIslandSnapshot(islands[0]!, receive);
    send(islands[0]!, 9);
    unsubscribe();
    stop();
    stop();
    expect(store.readIslandSnapshot(islands[0]!)).toBeUndefined();
    send(islands[0]!, 10);
    expect(store.readIslandSnapshot(islands[0]!)).toBeUndefined();
    stops.push(store.mountIslandSnapshots(root, 41, 'de'));
    send(islands[0]!, 1, { title: 'new epoch' });
    expect(store.readIslandSnapshot(islands[0]!)?.title).toBe('new epoch');
    expect(receive).toHaveBeenCalledTimes(1);
  });

  it('does not let an obsolete mount clear or duplicate its replacement', () => {
    const { root, islands, stop } = owner();
    const receive = vi.fn<(value: Snapshot) => void>();
    store.subscribeIslandSnapshot(islands[0]!, receive);
    stops.push(store.mountIslandSnapshots(root, 41, 'de'));
    send(islands[0]!, 1);
    stop();
    expect(store.readIslandSnapshot(islands[0]!)?.revision).toBe(1);
    send(islands[0]!, 2);
    expect(receive.mock.calls.map(([value]) => value.revision)).toEqual([1, 2]);
  });

  it('stops fanout of a snapshot superseded inside a subscriber', () => {
    const { islands } = owner();
    const receive = vi.fn<(value: Snapshot) => void>();
    store.subscribeIslandSnapshot(islands[0]!, (value) => {
      if (value.revision === 1) send(islands[0]!, 2);
    });
    store.subscribeIslandSnapshot(islands[0]!, receive);
    send(islands[0]!, 1);
    expect(receive.mock.calls.map(([value]) => value.revision)).toEqual([2]);
    expect(store.readIslandSnapshot(islands[0]!)?.revision).toBe(2);
  });

  it.each(['stop', 'remove', 'reparent'] as const)('stops fanout after reentrant %s', (action) => {
    const { root, islands, stop } = owner();
    const foreign = document.createElement('plp-astro-preview');
    root.append(foreign);
    const receive = vi.fn();
    store.subscribeIslandSnapshot(islands[0]!, () => {
      if (action === 'stop') stop();
      else if (action === 'remove') root.remove();
      else foreign.append(islands[0]!);
    });
    store.subscribeIslandSnapshot(islands[0]!, receive);
    send(islands[0]!, 1);
    expect(receive).not.toHaveBeenCalled();
  });

  it('does not receive events for detached or foreign nested islands', () => {
    const { root, islands } = owner();
    const foreign = document.createElement('plp-astro-preview');
    root.append(foreign);
    foreign.append(islands[0]!);
    send(islands[0]!, 1);
    islands[1]!.remove();
    send(islands[1]!, 1);
    expect(islands.map((island) => store.readIslandSnapshot(island))).toEqual([
      undefined,
      undefined,
    ]);
  });
});
