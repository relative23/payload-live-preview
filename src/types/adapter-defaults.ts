/**
 * The adapters' half of the defaults table, one export per option; the table as a whole is
 * described in `defaults-profile.ts`. A module for the reason `runtime-defaults.ts` is one: an
 * entry carries the rows it reads. Read it as a namespace, `import * as V2_ADAPTER_DEFAULTS`.
 */

export const strict = true;
export const previewSignals: readonly ('query' | 'fetch-dest' | 'referer')[] =
  /* @__PURE__ */ Object.freeze(['query'] as const);
export const previewQueryParams: readonly string[] = /* @__PURE__ */ Object.freeze([
  'preview',
  'draft',
  'livePreview',
] as const);
export const inject: 'preview-only' | 'always' = 'preview-only';
export const autoInject = true;
export const manageCsp: 'frame-ancestors' | 'full' = 'frame-ancestors';
export const strictDynamic = false;
export const assetPath = '/payload-live-preview';
/** On a page a framework hydrates and routes, where no fragment endpoint is set; elsewhere none. */
export const routeStrategy = 'router';
