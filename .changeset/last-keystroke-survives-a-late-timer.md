---
'payload-live-preview': patch
---

The preview no longer loses the last keystroke when the page is busy.

While an editor types into a field the server has to populate, the runtime sends one merge request as a burst starts and one as it ends. The end of the window is decided by the clock but sent by a timer, and a timer can run late: a busy main thread, a throttled engine. The last keystroke then went out as a new request first, and the late timer sent the older queued state after it. The answer to the older state replaced the newer one, and the preview showed the second-to-last text until the next keystroke or save. A new request now drops the queued older one before it goes out. What was saved was never affected. Found in WebKit against a real Payload admin; the batching arrived in 2.0.0-rc.1, and 1.8.1 does not have it.
