/**
 * A DOM for the server-side Lexical renderer, handed to it per call.
 *
 * `lexicalToHtml()` sanitizes what it produces only with a document. In the
 * browser the runtime has one; during SSR there is none unless the page
 * supplies it. `<RichText document={sanitizerDocument} requireDocument />`
 * gives it this one, and `requireDocument` makes a render without one throw
 * instead of returning unsanitised markup, as 3.0 does by default (ADR 0025).
 * The built-in node renderers escape their own values, so this matters for
 * custom renderers, which is what a project copying this example adds.
 *
 * linkedom is a devDependency here because this fixture renders at build time.
 */
import { parseHTML } from 'linkedom';
import type { SanitizerDocument } from 'payload-live-preview';

export const sanitizerDocument = parseHTML('<!doctype html><html><body></body></html>')
  .document as unknown as SanitizerDocument;
