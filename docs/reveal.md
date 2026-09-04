# Reveal the edited section

While editing in the Payload admin, the preview can scroll to the part of the
page you're writing, so you never lose the section under the cursor. The route
strategy already brings up the right _page_; this brings up the right _section_.

Off by default. Turn it on with one option.

## Tier 1 — follow the field you're typing in (no admin changes)

Set `revealEditedField` on the client/adapter config:

```ts
initLivePreview({
  allowedOrigins: [import.meta.env.PUBLIC_PAYLOAD_ADMIN_ORIGIN],
  revealEditedField: true,
});
```

When a field's value changes, the preview scrolls that field's bound element
(`[data-payload-field]`) into view. It works with stock Payload — no admin
component, no protocol change — because "the field whose value changed" is where
the cursor is.

Nested paths work the same way: a binding on `hero.title` or on a field inside
a block or array is found by its bound path, not only by a top-level field name.

It is deliberately quiet:

- It scrolls only when the target is **off-screen** — a field you can already
  see is left alone.
- It reveals only when the **edited field changes**, so typing on in one field
  never re-scrolls, and scrolling away from the field you're editing is not
  fought.
- It honours **`prefers-reduced-motion`** (no smooth-scroll animation then).
- The first message is a **baseline** — the initial document load never scrolls,
  and neither does a binding that has just appeared on the page.
- A value too large or too complex to compare (over 64 KB, or cyclic) never
  claims to have changed, so it cannot take the reveal from a field that did.
- It runs **after** the writes land, so the fragment and route strategies
  scroll to the element they just rendered, not to the one they replaced.
- On a page previewing **several documents**, it scrolls to the binding owned by
  the document being edited, even when another document on the page binds the
  same field name.

## Tier 2 — follow the cursor even without typing (opt-in admin helper)

Tier 1 covers writing. To also reveal a field when the editor just moves the
cursor into it (no edit), report focus from the admin. This runs in the Payload
admin, not the preview page:

```ts
import { createPreviewFocusReporter } from 'payload-live-preview';

const report = createPreviewFocusReporter(
  () => document.querySelector<HTMLIFrameElement>('iframe.live-preview')?.contentWindow ?? null,
  'https://preview.example.com', // the preview's exact origin — never '*'
);

// in a Payload field component:
//   onFocus={() => report(fieldName)}
```

`report(fieldName)` posts a `payload-live-preview-focus` message to the preview;
the runtime (with `revealEditedField` on) reveals that field with the same
off-screen / reduced-motion guards. `createPreviewFocusReporter` resolves the
target per call, so a lazily-created iframe is always addressed freshly, and it
is a no-op while the preview is closed.

`reportPreviewFocus(target, field, origin)` is the one-shot form if you already
hold the preview window.
