---
'payload-live-preview': patch
---

The Next.js middleware no longer blocks the preview under `manageCsp: 'full'`. In `proxy.ts` it receives `NextResponse.next()`, which has no body, and the layout renders the script without ever seeing the middleware's nonce; the `script-src` nonce it wrote was carried by no element, so the browser blocked the preview script and Next's own inline scripts with it. A response the middleware cannot inject the script into now keeps `frame-ancestors` only, and the middleware warns once in development. A response it does inject into still gets the nonce. To manage `script-src`, keep it in your own policy and pass its nonce to `LivePreviewScript`.
