---
'payload-live-preview': minor
---

SvelteKit and Nuxt fragment handlers now observe Node HTTP/1 disconnects after
upload and stop cooperative authorization, props and render work. An unread
request body is paused so a timeout response can reach the client before the
connection closes, while fully read requests retain keep-alive.

Pass the complete SvelteKit event to its handler. In Nuxt, pass the H3 event as
the optional second argument: `endpoint(toWebRequest(event), event)`. Existing
one-argument Nuxt calls remain supported and use the Web request's signal.
HTTP/2 and non-Node hosts retain their Web-signal transport behavior.
