/**
 * Every `innerHTML` write in the package, and why each one is safe.
 *
 * The runtime writes HTML in ten places. Eight receive markup this package
 * produced or checked; one is the sanitizer parsing untrusted markup into an
 * inert template in order to check it; one parses the project's own server
 * render. Nothing in the type system says so — `trustedHtml()` takes a string,
 * and the Trusted Types policy behind it is an identity policy, because a
 * sanitizer cannot re-verify from inside what it already guaranteed. Static
 * analysers read that shape as a DOM-XSS sink and are right to: the guarantee
 * lives in the call sites, not in the signature.
 *
 * So the call sites are the thing to hold still. A new sink, or a change to
 * what an existing one is fed, fails here until someone writes down which of
 * the four justifications applies. That is the review this file exists to
 * force; it is not a proof that the reasons are true.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const SRC = resolve(ROOT, 'src');

/**
 * `inert-parse`    — into a `<template>`, whose content is never activated:
 *                    no script runs, no resource loads.
 * `sanitised`      — the sanitizer produced it.
 * `escaped`        — built from escape helpers, which cannot emit markup.
 * `trusted-origin` — the project's own same-origin server render, trusted the
 *                    way any SSR framework trusts its own output.
 */
type Justification = 'inert-parse' | 'sanitised' | 'escaped' | 'trusted-origin';

const INVENTORY: ReadonlyMap<string, Justification> = new Map([
  ['src/field-types/html.ts::trustedHtml(sanitizeHtml(html))', 'sanitised'],
  [
    'src/field-types/array.ts::trustedHtml(sanitizeHtml(html, templateSanitizeOptions(template)))',
    'sanitised',
  ],
  ['src/field-types/rich-text.ts::trustedHtml(sanitizeHtml(html))', 'sanitised'],
  ['src/field-types/rich-text.ts::trustedHtml(sanitizeHtml(value))', 'sanitised'],
  // `lexicalToHtml` sanitises its own output whenever a DOM is reachable, which
  // in the browser is always. That is what covers a project's own
  // `registerBlockRenderer`, whose string this package never inspects.
  ['src/field-types/rich-text.ts::trustedHtml(lexicalToHtml(value))', 'sanitised'],
  [
    'src/field-types/upload.ts::trustedHtml(`<a href="${escapeHtmlAttribute(url)}">${label}</a>`)',
    'escaped',
  ],
  ['src/field-types/text.ts::trustedHtml(escapeAndLinebreak(text))', 'escaped'],
  // Sanitised first, then parsed inertly to be adopted — safe twice over.
  ['src/core/structural-applier.ts::trustedHtml(safe)', 'sanitised'],
  // The sanitizer's own parse. Untrusted markup by definition; it is read back
  // only after the fragment has been walked and stripped.
  ['src/security/sanitizer.ts::trustedHtml(html)', 'inert-parse'],
  // A fragment the project's server rendered, parsed here and morphed into the
  // boundary. Sanitising it would strip the page's own legitimate markup.
  ['src/core/strategy-runner.ts::trustedHtml(html)', 'trusted-origin'],
]);

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(path));
    else if (entry.name.endsWith('.ts') && !entry.name.includes('generated')) found.push(path);
  }
  return found;
}

interface Sink {
  readonly key: string;
  readonly file: string;
  readonly expression: string;
}

function htmlSinks(): Sink[] {
  const pattern = /\.innerHTML\s*=\s*([^\n]+?);\s*$/gm;
  const sinks: Sink[] = [];
  for (const path of sourceFiles(SRC)) {
    const file = relative(ROOT, path);
    const source = readFileSync(path, 'utf8');
    for (const match of source.matchAll(pattern)) {
      const expression = (match[1] ?? '').trim();
      sinks.push({ key: `${file}::${expression}`, file, expression });
    }
  }
  return sinks;
}

describe('HTML sink inventory', () => {
  const sinks = htmlSinks();

  it('finds the sinks at all', () => {
    // Guards the scanner itself: a regex that silently matches nothing would
    // make every assertion below vacuous.
    expect(sinks.length).toBeGreaterThanOrEqual(INVENTORY.size);
  });

  it('every innerHTML write is accounted for', () => {
    const unlisted = sinks.filter((sink) => !INVENTORY.has(sink.key)).map((sink) => sink.key);
    expect(unlisted, 'add the sink to INVENTORY with the justification that applies').toEqual([]);
  });

  it('no inventory entry has gone stale', () => {
    const live = new Set(sinks.map((sink) => sink.key));
    const stale = [...INVENTORY.keys()].filter((key) => !live.has(key));
    expect(stale, 'the sink moved or changed; re-check it and update the entry').toEqual([]);
  });

  it('every write goes through the Trusted Types policy', () => {
    const bare = sinks.filter((sink) => !sink.expression.startsWith('trustedHtml('));
    expect(bare.map((sink) => sink.key), 'assign trustedHtml(...) so the page keeps working under a Trusted Types CSP').toEqual([]);
  });

  it('only a template is fed markup this package did not check', () => {
    const raw = [...INVENTORY.entries()].filter(
      ([, justification]) => justification === 'inert-parse' || justification === 'trusted-origin',
    );
    for (const [key] of raw) {
      const source = readFileSync(resolve(ROOT, key.slice(0, key.indexOf('::'))), 'utf8');
      expect(source, `${key} must parse into a template, not a live element`).toContain(
        'createElement(\'template\')',
      );
    }
  });
});
