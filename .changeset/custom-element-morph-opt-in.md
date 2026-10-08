---
'payload-live-preview': minor
---

Add the `data-payload-morph` attribute to opt custom elements into live-preview updates of host attributes and server-rendered light DOM. The attribute must be present on both the current element and the newly rendered element; its value is ignored. Compatible hosts retain their identity, while shadow roots and protected descendants remain untouched.
