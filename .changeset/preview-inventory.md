---
'payload-live-preview': minor
---

Publish which schema fields a binding can actually address. `pll-codegen --inventory <path>` writes every addressable field as JSON — spelled the way the runtime resolves it — and `checkPreviewBindings()` cross-checks bindings a consumer has already extracted, reporting unknown slugs and fields that no longer exist. The path convention is the part worth publishing rather than documenting: structural containers (`tabs`, `row`, `collapsible`) contribute no segment, arrays address items through `.*`, and blocks through `.*.<slug>`. Markup extraction stays with the consumer, because resolving a binding expression in Astro, JSX or Svelte is framework work this package cannot do generically.
