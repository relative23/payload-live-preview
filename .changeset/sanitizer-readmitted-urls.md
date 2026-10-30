---
'payload-live-preview': patch
---

`sanitizeHtml()` checks the URLs of attributes that `additionalAllowedAttributes` re-admits. It checked only `href`, `src`, `cite` and `poster`, so an option that re-admitted `formaction`, `action` or `ping` kept a `javascript:` value: `<button formaction="javascript:…">` came through unchanged when form controls were allowed as well. `action` and `formaction` are now removed when `isSafeUrl` refuses them, and a `ping` goes when one of its space-separated targets does. The built-in lists admit none of the three, so output without that option is unchanged.
