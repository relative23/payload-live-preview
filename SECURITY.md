# Security Policy

## Supported versions

| Version            | Supported                             |
| ------------------ | ------------------------------------- |
| 2.x                | Yes                                   |
| 1.x                | Security fixes only, until 2026-12-13 |
| < 1.0 (alpha/beta) | No                                    |

1.x receives security fixes for 90 days after 2.0.0, which was published on 2026-09-14.

## Reporting a vulnerability

Please report vulnerabilities privately — do not open a public issue.

- Preferred: [GitHub private vulnerability reporting](https://github.com/relative23/payload-live-preview/security/advisories/new) on this repository.
- Alternatively: email relativesharp@gmail.com.

Include the affected version, a proof of concept or reproduction steps, and the impact as you understand it.

## Response expectations

This is a solo-maintained project. Reports are handled on a best-effort basis; you can expect an acknowledgement within a few days and a fix or mitigation as soon as practical. Please allow a reasonable disclosure window before publishing details.

## Scope

This library renders CMS-controlled content into consumer pages and decides on the server which requests get a preview, so the rendering, message-handling and authorization paths are security boundaries. In scope:

- Bypasses of the HTML sanitizer (`src/security/sanitizer.ts`)
- Bypasses of URL validation (`src/security/url-validator.ts`)
- Bypasses of postMessage origin detection/allow-listing
- Anything that lets a malicious parent window or CMS payload execute script in the preview page
- Bypasses of the authorization boundary: a forged, expired, replayed or wrongly scoped preview token or session that `authorizePreviewRequest()` accepts, draft content read without credentials, or the fragment endpoint (`createFragmentEndpoint()`) rendering for a request it should refuse

Out of scope: vulnerabilities in Payload CMS itself, in consumer application code, or in dependencies (report those upstream).

## Threat model summary

The primary adversaries are an unauthenticated HTTP requester and a malicious parent
window. Preview-intent signals are not authorization; applications must verify a
server session or short-lived scoped signature before privileged draft reads, cache
bypass, CSP changes, or runtime injection. Under the strict default, the adapters that
decide per request (`createLivePreviewMiddleware()`, `livePreviewHandle()`,
`livePreviewNitroPlugin()`, `defineLivePreviewServerHandler()`) refuse to start
without `authorizePreview`; Astro's `inline` and `loader` modes inject at build time
and check nothing. Browser defenses are layered:

- **postMessage origin policy** — inbound messages must come from an explicit
  `allowedOrigins` entry. `document.referrer` is ignored by default
  (`disableReferrerDetection: true`), and localhost origins are accepted only in
  development, which the inline runtime reads from the page's own hostname
  (`localhost` or `127.0.0.1`). Under the default
  `eventSourcePolicy: 'parent-or-opener'`, a message must also come from the window
  that framed or opened the page. The inline runtime and `LivePreviewClient` then
  lock to the first origin that sent an accepted update. `defaults: 'v1'` restores
  the 1.x referrer fallback and accepts any window on a trusted origin. Production
  deployments should configure explicit origins and an appropriate `frame-ancestors`
  CSP.
- **Escape-by-default rendering** — field values are escaped unless a field is explicitly typed as HTML, in which case it is sanitized. Rich text is written as sanitized HTML too: a Lexical value is detected automatically, and a project's `renderRichText` output passes the same sanitizer.
- **CSP helpers** — utilities for generating Content-Security-Policy headers compatible with the inline runtime.

The full security model is documented in [docs/security.md](docs/security.md).
