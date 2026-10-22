---
'payload-live-preview': patch
---

A preview write no longer waits for an animation frame the browser does not give. The runtime applied a scheduled write only in a `requestAnimationFrame` callback, and WebKit gave a visible cross-origin preview frame no frame for seconds (the real-admin suite, `animationFramesIn600ms: 0`): the document had arrived and the page kept the old text. A write now waits at most 100 ms for the frame; the frame or the fallback timer, whichever comes first, writes, and the other does nothing. Where frames come, nothing changes.
