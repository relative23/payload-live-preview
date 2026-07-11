# Security Policy

## Supported versions

| Version | Supported |
| --- | --- |
| 1.x | Yes |
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

The primary adversary is a malicious parent window. Defenses are layered:

- **postMessage origin allow-listing** — inbound messages are dropped unless the origin is explicitly allowed, then the detector locks to the first verified origin.
- **Escape-by-default rendering** — field values are escaped unless a field is explicitly typed as HTML, in which case it is sanitized.
- **CSP helpers** — utilities for generating Content-Security-Policy headers compatible with the inline runtime.

The full security model is documented in [docs/security.md](docs/security.md).
