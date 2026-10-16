/**
 * Native React hydration uses the same component tree as the server.
 * Recovery errors enter the observed ledger for the prepared gate to refuse.
 */
import React from 'react';
import { hydrateRoot } from 'react-dom/client';
import { App } from './react-app.mjs';
import { ledger } from './ledger.mjs';
const props = JSON.parse(document.getElementById('r6-props').textContent);
hydrateRoot(
  document.getElementById('app'),
  React.createElement(React.StrictMode, null, React.createElement(App, props)),
  {
    onRecoverableError: (error) => ledger().hydrationErrors.push(String(error)),
  },
);
