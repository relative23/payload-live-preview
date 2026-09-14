# Reveal the edited section

While editing in the Payload admin, the preview scrolls to the **field** being
edited, when that field is off-screen. The route strategy brings up the right
_page_; this brings up the right _field_.

**Per field, not per line.** A field taller than the viewport whose top edge is
already on screen counts as visible and is never scrolled to, however far below
the caret sits inside it. A long rich-text body is exactly that case, and this
feature does not help there — see [What this does not do](#what-this-does-not-do).

Off by default. One option turns it on.

## Tier 1 — follow the field being typed in (no admin changes)

Set `revealEditedField` on the client, the inline script or any adapter
([docs/options.md](options.md)):

```ts
initLivePreview({
  allowedOrigins: [import.meta.env.PUBLIC_PAYLOAD_ADMIN_ORIGIN],
  revealEditedField: true,
});
```

When a field's value changes, the preview scrolls that field's bound element
(`[data-payload-field]`, see [docs/bindings.md](bindings.md)) into view. It
works with stock Payload — no admin component, no protocol change — because the
field whose value changed is the field the caret is in. _Which part_ of that
field, it cannot know: the message carries values, not a caret position.

Nested paths work the same way: a binding on `hero.title` or on a field inside
a block or array is found by its bound path, not only by a top-level field name.

It is deliberately quiet:

- It scrolls only when the target is **off-screen** — a field the editor can
  already see is left alone.
- It reveals only when the **edited field changes**, so typing on in one field
  never re-scrolls, and scrolling away from the field being edited is not
  fought.
- It honors **`prefers-reduced-motion`** (no smooth-scroll animation then).
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

Tier 1 covers writing. To also reveal a field when the editor only moves the
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
target per call, so a lazily created iframe is always addressed freshly, and it
is a no-op while the preview is closed.

`reportPreviewFocus(target, field, origin)` is the one-shot form for callers
that already hold the preview window.

## What this does not do

**It does not follow the caret inside a field.** A field is one binding, and the
only thing either tier puts on the wire is a field _name_ — `payload-live-preview`
carries values, `payload-live-preview-focus` carries `{ type, field }`. Neither
carries a caret position, so there is nothing finer to scroll to. A heading or a
paragraph inside a rich-text body is not separately bound and the runtime cannot
see it.

**So a long field is the case this misses.** `revealElement` asks whether the
bound element is off-screen, and a box that starts above the fold and runs far
past it is on screen by that measure. Measured on a real document (2026-09-13):
a `description` body 1,740px tall starting at 721px in a 1,389px preview frame —
its top edge is visible, so the reveal correctly does nothing while the caret
sits 1,500px further down. Every _other_ field on that page, being shorter than
the frame, reveals as documented.

If the editor needs the caret followed inside a long body, this feature is not
the answer today: it would take a caret position on the wire, which is a
protocol change, an ADR and a compatibility question — not a setting.
