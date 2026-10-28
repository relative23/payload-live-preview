---
'payload-live-preview': patch
---

`pll doctor` counts binding and owner attributes in start tags only. It matched `data-payload-field=` anywhere in the visible markup, so a page that shows `<h1 data-payload-field="title">` as a code sample was told it serves binding attributes to anonymous visitors (`LP0704`: three on a page that served none), and a sentence that names `data-payload-owner` counted as an owner marker (`LP0706`). `LP0707`, the error that a preview response gives the runtime nothing to write into, no longer fires on a page whose edits arrive through `data-payload-fragment` boundaries: pages with 8 and 14 boundaries and no field binding were told that no edit could ever be visible.
