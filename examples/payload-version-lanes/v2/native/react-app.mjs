/**
 * Existing React controls replace the installed hook without replacing its realm. Passive owner and
 * public-snapshot metadata distinguish a fresh keyed mount from StrictMode reattachment; the SDK
 * still owns every subscription and merge.
 */
import React, { StrictMode, useEffect, useRef, useState } from 'react';
import { useLivePreviewDocument } from 'payload-live-preview/react';
import {
  beginOwner,
  commitSnapshot,
  connection,
  initialData,
  installControls,
  ledger,
  observeSnapshot,
  ownerCleanup,
  ownerSetup,
} from './ledger.mjs';
const h = React.createElement;

function Preview({ admin, document, receiverIndex, generation, seed }) {
  // Native Windows stay local: React's development profiler walks changed props.
  const target = receiverIndex === undefined ? undefined : window.parent.frames[receiverIndex];
  const held = useRef(null);
  if (held.current === null) {
    const ownSeed = seed ?? initialData(document);
    held.current = { seed: ownSeed, owner: beginOwner('react', document, generation, ownSeed) };
  }
  const owner = held.current.owner;
  const snapshot = useLivePreviewDocument({
    initialData: held.current.seed,
    ...connection(admin, target, owner),
  });
  // Render observes the public initial snapshot before subscription sends Ready.
  observeSnapshot(owner, snapshot, 'render');
  const [count, setCount] = useState(0);
  useEffect(() => {
    ledger().strictSetups += 1;
    ownerSetup(owner);
    return () => {
      ledger().strictCleanups += 1;
      ownerCleanup(owner);
    };
  }, []);
  useEffect(() => {
    observeSnapshot(owner, snapshot, 'commit');
    commitSnapshot(owner, snapshot);
  }, [snapshot, document, target, generation]);
  return h(
    'article',
    null,
    h('h1', { 'data-testid': 'title' }, snapshot.data.title),
    h('p', { 'data-testid': 'subtitle' }, snapshot.data.subtitle),
    h('p', { 'data-testid': 'status' }, snapshot.status),
    h('p', { 'data-testid': 'revision' }, String(snapshot.revision)),
    h(
      'p',
      { 'data-testid': 'author' },
      typeof snapshot.data.author === 'object' && snapshot.data.author !== null
        ? (snapshot.data.author.email ?? snapshot.data.author.name ?? '')
        : '',
    ),
    h(
      'button',
      { 'data-testid': 'counter', onClick: () => setCount((value) => value + 1) },
      String(count),
    ),
    h('input', { 'data-testid': 'visitor', defaultValue: 'Visitor value' }),
    snapshot.error ? h('p', { 'data-testid': 'error' }, snapshot.error.message) : null,
  );
}

export function App({ admin, document, initialData: seed }) {
  const [mounted, setMounted] = useState(true);
  const [generation, setGeneration] = useState(1);
  const [receiverIndex, setReceiverIndex] = useState(undefined);
  useEffect(() => {
    ledger().ready = true;
    ledger().document = document;
    return installControls(admin, (_target, checkedIndex) => setReceiverIndex(checkedIndex));
  }, [admin, document]);
  return h(
    React.Fragment,
    null,
    h('output', { 'data-testid': 'scope' }, mounted ? 'active' : 'stopped'),
    h('output', { 'data-testid': 'generation' }, String(generation)),
    h(
      'button',
      { 'data-testid': 'stop-preview', onClick: () => setMounted(false) },
      'Unmount preview',
    ),
    h(
      'button',
      {
        'data-testid': 'restart-preview',
        onClick: () => {
          setGeneration((value) => value + 1);
          setMounted(true);
        },
      },
      'Mount a new preview',
    ),
    mounted
      ? h(
          StrictMode,
          null,
          h(Preview, {
            key: document + ':' + generation,
            admin,
            document,
            receiverIndex,
            generation,
            seed,
          }),
        )
      : null,
  );
}
