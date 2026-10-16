---
'payload-live-preview': patch
---

The sanitizer's output is now a fixed point: `sanitizeHtml()` parses, sanitises and writes again until a pass changes nothing, so the string it returns is the one a consumer's `innerHTML` rebuilds. Before, unwrapping an unknown tag could leave an `a` inside an `a` or a `li` inside a `li`, and the parser rewrote them on the next pass. Output that does not settle after six parses is returned as an empty string, with a development warning. `isSafeUrl()` and the `srcset` check also read a scheme through whitespace and control characters, as DOMPurify does: `java script:` and `foo :` are refused, and a relative URL with a space before a colon (`my file: notes.pdf`) is no longer accepted. Found by the daily property exploration (ADR 0016, addendum of 2026-10-02).
