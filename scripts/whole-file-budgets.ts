/**
 * What a bundler that takes a file whole ships for one export: the chunk the
 * entry takes the name from and everything that chunk imports, in raw bytes.
 * webpack and Turbopack bundle that way, and so does a Next.js project; the
 * tree-shaking rows measure Vite, which drops what is unused inside a file, and
 * would not move if two features became one chunk. Read off `dist` without a
 * bundler, so a row moves with the build alone (ADR 0007, row 46).
 */

export interface WholeFileRow {
  /** The entry's file under `dist/`. */
  readonly entry: string;
  /** The one export a project takes from it. */
  readonly symbol: string;
  /** Budget in raw bytes. */
  readonly raw: number;
  /** What the number stands for. */
  readonly why: string;
}

/**
 * Measured 2026-11-27 on the build that draws a chunk boundary around every
 * module that defines a public name (scripts/chunk-boundaries.ts), Node 24.22.3
 * and npm 12.0.2; each budget is the measurement and about half a percent.
 * Without the boundaries the client, the plugin manager and the built-in
 * plugins were one chunk of 123 596 bytes, which is what every one of the first
 * four rows would have taken; a Next.js 16 app then shipped 17 kB gzip for
 * `PluginManager` where it ships 2.8 kB.
 */
export const WHOLE_FILE_ROWS: readonly WholeFileRow[] = [
  {
    entry: 'client.js',
    symbol: 'escapeHtml',
    raw: 576,
    why: 'the escape tables and one function: no part of the sanitizer',
  },
  {
    entry: 'client.js',
    symbol: 'highlightPlugin',
    raw: 2_310,
    why: 'one built-in plugin, without the manager, the other plugins or the client',
  },
  {
    entry: 'client.js',
    symbol: 'PluginManager',
    raw: 10_240,
    why: 'the manager and the event emitter, without a built-in plugin or the client',
  },
  {
    entry: 'client.js',
    symbol: 'morphElement',
    raw: 5_900,
    why: 'the keyed morph and the island rules it obeys',
  },
  {
    entry: 'client.js',
    symbol: 'createDocumentSession',
    raw: 19_700,
    why: 'the session behind the hooks: the message bus, the origin detector and the merger, no renderer',
  },
  {
    entry: 'client.js',
    symbol: 'initLivePreview',
    raw: 168_400,
    why: 'the client with its renderers: what it needs, and not what the entry exports beside it',
  },
];
