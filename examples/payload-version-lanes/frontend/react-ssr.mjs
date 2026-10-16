/**
 * SSR executes the installed hook without a browser or invented session.
 * The native server renderer reads the package's initial document snapshot.
 */
import React from 'react';
import { renderToString } from 'react-dom/server';
import { App } from './react-app.mjs';
export function render(props) {
  return renderToString(
    React.createElement(React.StrictMode, null, React.createElement(App, props)),
  );
}
