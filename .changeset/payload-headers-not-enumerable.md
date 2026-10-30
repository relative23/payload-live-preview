---
'payload-live-preview': patch
---

`payloadHeaders` on an authorized preview context is no longer enumerable. It can carry the editor's HttpOnly `payload-token` cookie, and the adapters publish the context on `locals` and `event.context`, so `JSON.stringify(locals)`, a log of the context or a page that returned it to the browser wrote the cookie out. `JSON.stringify`, a spread, `Object.keys` and `util.inspect` now leave it out; reading `context.payloadHeaders` by name, as a draft read does, is unchanged.
