# Security Policy

## Supported versions

| Version            | Supported              |
| ------------------ | ---------------------- |
| 1.x                | Yes                    |
| < 1.0 (alpha/beta) | Latest prerelease only |

## Reporting a vulnerability

Please report vulnerabilities privately — do not open a public issue.

- Preferred: [GitHub private vulnerability reporting](https://github.com/relative23/payload-live-preview/security/advisories/new) on this repository.
- Alternatively: email relativesharp@gmail.com.

Include the affected version, a proof of concept or reproduction steps, and the impact as you understand it.

## Response expectations

This is a solo-maintained project. Reports are handled on a best-effort basis; you can expect an acknowledgement within a few days and a fix or mitigation as soon as practical. Please allow a reasonable disclosure window before publishing details.

## Scope

This library renders CMS-controlled content into consumer pages, so the rendering and message-handling paths are security boundaries. In scope:

- Bypasses of the HTML sanitizer (`src/security/sanitizer.ts`)
- Bypasses of URL validation (`src/security/url-validator.ts`)
- Bypasses of postMessage origin detection/allow-listing
- Anything that lets a malicious parent window or CMS payload execute script in the preview page

Out of scope: vulnerabilities in Payload CMS itself, in consumer application code, or in dependencies (report those upstream).

## Threat model summary

The primary adversaries are an unauthenticated HTTP requester and a malicious parent
window. Preview-intent signals are not authorization; applications must verify a
server session or short-lived scoped signature before privileged draft reads, cache
bypass, CSP changes, or runtime injection. Browser defenses are layered:

- **postMessage origin policy** — inbound messages must match an explicit origin,
  or the documented development-localhost/referrer fallback when no explicit origin
  is configured. The detector then locks to the first verified origin. Production
  deployments should configure explicit origins and an appropriate `frame-ancestors`
  CSP.
- **Escape-by-default rendering** — field values are escaped unless a field is explicitly typed as HTML, in which case it is sanitized.
- **CSP helpers** — utilities for generating Content-Security-Policy headers compatible with the inline runtime.

The full security model is documented in [docs/security.md](docs/security.md).
