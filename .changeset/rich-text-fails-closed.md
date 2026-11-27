---
'payload-live-preview': major
---

`lexicalToHtml()` and Astro's `<RichText>` throw `SanitizerEnvironmentError` where they have no document to sanitise with, instead of returning the markup unsanitised with a warning (ADR 0007, row 18; ADR 0025). Pass a `document` per call on a server (`lexicalToHtml(content, { document })`, `<RichText document={…} />`, from linkedom or jsdom). `requireDocument: false` keeps the 2.x behaviour, and `sanitize: false` still says that the caller sanitises itself. In a browser nothing changes.
