---
'payload-live-preview': patch
---

`withLivePreview()` no longer writes a `Content-Security-Policy` header.

A `next.config` header rule cannot run `authorizePreview`, so it could never be
where a privileged response change is decided. It could not widen
`frame-ancestors` safely either: Next collects every matching rule into one
object keyed by header name and applies it with `setHeader`, and this package's
rules are appended after yours, so the policy it wrote replaced the one your
site already sends. Measured on Next.js 16.3.4: a site whose own rule sends
`frame-ancestors 'none'` answered a bare, unauthenticated `/?preview=true` with
`frame-ancestors 'self' <admin>` and nothing else — its `script-src` and every
other directive gone, for anyone who appends the query parameter.

`frame-ancestors` for the admin origin comes from `createLivePreviewMiddleware()`,
which merges into an existing policy and only for a request the policy engine
authorized. The rule still marks an intent-bearing request `private, no-store`,
and `withLivePreview()` still adds the admin host to `allowedDevOrigins`.
