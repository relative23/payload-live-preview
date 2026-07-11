// SvelteKit ambient types. The live preview handle writes the CSP nonce
// it generated for the current request into `locals`.
declare global {
  namespace App {
    interface Locals {
      livePreviewNonce?: string;
    }
  }
}

export {};
