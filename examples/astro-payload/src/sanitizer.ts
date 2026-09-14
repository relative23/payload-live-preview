/**
 * Give the server-side Lexical renderer a DOM, once, before any page renders.
 *
 * `lexicalToHtml()` sanitizes what it produces only when a document is
 * available. In the browser the runtime has one; during SSR there is none
 * unless the project supplies it, and without one the renderer returns its
 * output unsanitised and warns (see docs/security.md §3). The built-in node
 * renderers escape their own values, so this matters for custom renderers —
 * which is exactly what a project copying this example will add.
 *
 * linkedom is a devDependency here because this fixture renders at build time.
 * A project rendering per request wants the same call in whatever runs first.
 */
import { parseHTML } from 'linkedom';
import { setSanitizerDocument } from 'payload-live-preview';

const { document } = parseHTML('<!doctype html><html><body></body></html>');
setSanitizerDocument(document as unknown as Parameters<typeof setSanitizerDocument>[0]);
