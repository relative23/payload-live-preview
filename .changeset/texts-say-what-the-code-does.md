---
'payload-live-preview': patch
---

Three texts named options that do not do what they said. `LP0409` no longer sends a runtime user to `allowedDataAttributes`, an option of a direct `sanitizeHtml()` call that the runtime's own writes cannot take; it names the template's own markup and `sanitizerPolicy: 'compat'`. `LP0408` lists the `time:` and `datetime:` styles it accepts. `pll migrate --help` lists all six codemods; it named four. `LEAN_RUNTIME` is marked `@beta`, which is the class the package-entry table in `docs/options.md` already gave `/lean`.
