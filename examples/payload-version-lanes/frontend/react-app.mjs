/**
 * Real React controls mount and remove the installed preview hook. A target
 * change keeps this component's key and visitor state, so a remount cannot mask
 * a missing receiver identity in the package's session key.
 */
import React, { StrictMode, useEffect, useState } from 'react';
import { useLivePreviewDocument } from 'payload-live-preview/react';
import { connection, initialData, installControls, ledger } from './ledger.mjs';
const h = React.createElement;

function Preview({ admin, document, receiverIndex, generation, seed }) {
  // Native Windows stay local: React's development profiler walks changed props.
  const target = receiverIndex === undefined ? undefined : window.parent.frames[receiverIndex];
  const snapshot = useLivePreviewDocument({
    initialData: seed ?? initialData(document),
    ...connection(admin, target),
  });
  const [count, setCount] = useState(0);
  useEffect(() => {
    ledger().strictSetups += 1;
    return () => {
      ledger().strictCleanups += 1;
    };
  }, []);
  useEffect(() => {
    // This is the public hook snapshot after React's commit, not an internal
    // DocumentSession identity or a replacement subscription implementation.
    ledger().activeSession = {
      observation: 'native-react-public-snapshot',
      nativeConsumer: document + ':' + generation,
      document,
      receiver: target === undefined ? 'primary' : 'secondary',
      revision: snapshot.revision,
      status: snapshot.status,
      isLoading: snapshot.isLoading,
      title: String(snapshot.data.title ?? '').slice(0, 2048),
      error: snapshot.error ? String(snapshot.error.message).slice(0, 2048) : null,
    };
    if (snapshot.revision > 0 && !snapshot.isLoading && snapshot.status === 'live') {
      ledger().commits.push({
        marker: snapshot.data.title,
        revision: snapshot.revision,
        document,
        target: ledger().target,
      });
    }
  }, [snapshot, document, target, generation]);
  return h(
    'article',
    null,
    h('h1', { 'data-testid': 'title' }, snapshot.data.title),
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
