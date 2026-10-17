---
'payload-live-preview': minor
---

A media document's relative `url` loads in a preview on another origin. Payload returns `/api/media/file/a.png`, a path on its own origin, unless its config sets `serverURL`; the `upload` and `image` renderers wrote it unchanged, so the preview asked its own server for the file and got a 404. With a `serverURL` the runtime now resolves that path, and every `sizes` candidate, against it, as Payload's admin does. Any other URL, and every URL without a `serverURL`, is written as before. `RenderContext` has an optional `serverURL` for custom renderers. Media inside rich text is written as delivered, as before; it loads only when Payload returns absolute URLs.
