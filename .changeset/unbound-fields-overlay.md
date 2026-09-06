---
'payload-live-preview': minor
---

Add `createUnboundFieldsOverlayPlugin()`: a development overlay that lists the
fields an update carried and the page has nowhere to put.

```ts
import { createUnboundFieldsOverlayPlugin } from 'payload-live-preview/plugins';

void client.use(createUnboundFieldsOverlayPlugin());
```

Annotating a template is the work this package asks for, and the hard part is
knowing what is still missing. `inspect().bindings.orphanFields` answers that in
the console — the wrong place while you are editing markup. The overlay puts the
same answer in the preview, and a click copies `data-payload-field="…"` for the
field you picked.

It recomputes on every update from the message's own fields and the bindings
currently in the DOM, so entries disappear as you save the file that binds them.
The rule for "covered" is the runtime's own: the fields Payload sends with every
document never appear, a locale-suffixed name counts, and a binding on a path
inside a field — `hero.eyebrow` for `hero` — covers it.

It mounts only when the client runs with `debug: true`, and it is a plugin rather
than part of the runtime so that no page carries a development tool it did not
ask for: the inline script's byte budget is unchanged by it.
