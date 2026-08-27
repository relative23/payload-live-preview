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
    }
  }
}

export {};
