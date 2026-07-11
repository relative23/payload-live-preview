//#region src/routes/+page.ts
/**
* Client-side rendering is disabled for the preview page: the bound
* elements are patched in place by the live preview runtime, and a
* hydrating Svelte component would overwrite those patches on mount.
* With `csr = false` SvelteKit ships zero client JS for this route —
* the only script on the page is the injected preview runtime.
*/
var csr = false;
//#endregion
export { csr };
