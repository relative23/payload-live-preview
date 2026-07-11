# Migration guide

## From `0.1.0` of this package

`1.0.0` is a clean break — there is no API shim. The migration is small in code but large in semantics:

| `0.1.0` | `1.0.0` |
|---|---|
| `initLivePreview(config)` returns `LivePreviewClient \| null` | Same signature, but `config.allowedOrigins` is **required** when neither `document.referrer` nor a localhost origin can vouch for the parent. |
| `livePreviewEvents` (module singleton) | Each `LivePreviewClient` owns an `EventEmitter`; access via `client.events`. |
| `client.use(plugin)` | Same API. Plugins now receive a per-instance `PluginContext` instead of touching shared state. |
| `getFrameAncestors()` | Replaced by `buildFrameAncestors({ self, origins })` — typed, deduplicates, supports `'none'`. |
| `safeSetTextContent(el, str)` | Removed. Use `el.textContent = str` directly (the original was a no-op wrapper). |
| `data-payload-array-template` | Unchanged. Add `data-payload-structural` to opt into diff-based updates with View-Transitions. |

### Breaking semantics

- `isSafeUrl('')` now returns `false` (was `true`). This affects edge cases where an empty string was being mistakenly treated as a safe URL.
- The hard-coded `'de'` locale fallback for dates/numbers is gone; the runtime now reads `navigator.language` or `<html lang="…">`, falling back to `'en'`.
- The previous inline runtime broadcast to a hard-coded localhost port list. `1.0.0` allows any localhost port in dev via a regex; the broadcast list is wider.

## From `@payloadcms/live-preview`

The official React-focused library and this package coexist; they have different focuses:

| Use this | When |
|---|---|
| `@payloadcms/live-preview-react` | You're rendering inside React and can `useLivePreview` directly. |
| `payload-live-preview` | You're rendering with Astro, SvelteKit, Nuxt, plain HTML — or want DOM-binding semantics that survive SSR/SSG. |

Migration steps when moving from the official library:

1. Stop calling `useLivePreview()` in React components.
2. Annotate the **rendered** DOM with `data-payload-field="…"` attributes.
3. Mount our library once (`generateInlineScript` or the relevant adapter).
4. Updates flow into the DOM directly — no React re-renders needed for previews.

This makes previews work in environments where React isn't available (Astro `static` pages, plain server-rendered Svelte) and survives full-page hydration boundaries.
