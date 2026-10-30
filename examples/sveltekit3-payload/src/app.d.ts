// SvelteKit ambient types. The live preview handle writes the CSP nonce it
// generated for the current request into `locals`, and — when the request
// was an authorized preview — the verified context the page's `load`
// passes to `createPreviewBindings` and the draft helpers.
import type { AuthorizedPreviewContext } from 'payload-live-preview';

declare global {
  namespace App {
    interface Locals {
      livePreviewNonce?: string;
      livePreviewAuthorization?: AuthorizedPreviewContext;
      /** Set by this app's own hook for every request; the page's load and the fragment's props both read it. */
      edition?: string;
    }
  }
}

export {};
