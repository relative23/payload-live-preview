# @relative23/payload-live-preview

> State-of-the-art, framework-agnostic, schema-driven live preview for Payload CMS. Astro-first; works with Next.js, SvelteKit, Nuxt, and plain HTML.

## Highlights

| | |
|---|---|
| **Single source of truth** | One TypeScript runtime compiled to a 34 KB IIFE at build time — no parallel inline/class implementations to drift. |
| **Complete Lexical renderer** | 14 node types incl. `upload`, `relationship`, `block`, `autolink`, `tab`, indent, RTL — closes the gap vs. `@payloadcms/live-preview`. |
| **Schema-driven** | Parses Payload's `fieldSchemaJSON`, walks groups/arrays/blocks/tabs, auto-resolves field types without DOM annotations. |
| **Structural updates** | id-keyed array/block diff applied as minimal DOM patches with View-Transitions animation where supported. |
| **Strict security** | 100 % security-coverage, CSP nonce + `'strict-dynamic'`, escape-by-default sanitizer with extended whitelist, prototype-pollution guard. |
| **Per-instance** | No module-level singletons — multiple clients coexist, `destroy()` only affects its own listeners. |
| **Production-safe defaults** | Pattern-based localhost matching for dev, handshake-verified origin lock for prod, heartbeat + reconnect, off-screen replay queue. |
| **First-class adapters** | Astro (integration + middleware), Next.js, SvelteKit, Nuxt — all share the same core. |

## Install

```bash
npm install @relative23/payload-live-preview
```

## Quick start

### Astro (zero-config)

```ts
// astro.config.mjs
import { defineConfig } from 'astro/config';
import { livePreview } from '@relative23/payload-live-preview/astro';

export default defineConfig({
  integrations: [
    livePreview({
      allowedOrigins: [import.meta.env.PUBLIC_PAYLOAD_ADMIN_ORIGIN],
    }),
  ],
});
```

Annotate the elements you want bound:

```astro
<h1 data-payload-field="title">{title}</h1>
<div data-payload-field="body" data-payload-richtext>...</div>
<img data-payload-field="hero" alt={alt} src={url} />
```

That's it — the inline script auto-detects the iframe context and starts updating.

### Next.js (App Router)

```ts
// middleware.ts
import { NextResponse, type NextRequest } from 'next/server';
import { createLivePreviewMiddleware } from '@relative23/payload-live-preview/nextjs';

const livePreview = createLivePreviewMiddleware({
  allowedOrigins: [process.env.PAYLOAD_ADMIN_ORIGIN!],
});

export async function middleware(request: NextRequest) {
  const response = NextResponse.next();
  return livePreview(request, response);
}
```

### SvelteKit

```ts
// src/hooks.server.ts
import { livePreviewHandle } from '@relative23/payload-live-preview/sveltekit';
export const handle = livePreviewHandle({
  allowedOrigins: [process.env.PAYLOAD_ADMIN_ORIGIN!],
});
```

### Nuxt 3

```ts
// server/middleware/live-preview.ts
import { defineLivePreviewServerHandler } from '@relative23/payload-live-preview/nuxt';
export default defineLivePreviewServerHandler({
  allowedOrigins: [process.env.NUXT_PUBLIC_PAYLOAD_ADMIN_ORIGIN!],
});
```

Embed the rendered script in your layout via `useHead`.

### Plain HTML (advanced)

```ts
import { generateInlineScript } from '@relative23/payload-live-preview';
const script = generateInlineScript({
  allowedOrigins: ['https://admin.example.com'],
});
// Inject into your template via `<script>${script}</script>` or `dangerouslySetInnerHTML`.
```

## Data-attribute reference

| Attribute | Purpose | Example |
|-----------|---------|---------|
| `data-payload-field` | Bind element to a Payload field path | `data-payload-field="hero.title"` |
| `data-payload-type` | Force a specific renderer | `data-payload-type="image"` |
| `data-payload-href` | Read `href` from a sibling field | `data-payload-href="ctaUrl"` |
| `data-payload-src` | Read `src` from a sibling field | `data-payload-src="hero.url"` |
| `data-payload-alt` | Read `alt` from a sibling field | `data-payload-alt="hero.alt"` |
| `data-payload-richtext` | Render value as Lexical rich text | `data-payload-richtext` |
| `data-payload-html` | Render value as sanitised HTML | `data-payload-html` |
| `data-payload-array` | Treat value as an array | `data-payload-array` |
| `data-payload-array-template` | HTML template per array item | `data-payload-array-template="<li>{{title}}</li>"` |
| `data-payload-array-separator` | Separator for primitive arrays | `data-payload-array-separator=" · "` |
| `data-payload-structural` | Use diff-based structural updates | `data-payload-structural` |
| `data-payload-locale` | Override locale for this element | `data-payload-locale="de-AT"` |

## Field types

`text` · `textarea` · `richText` · `html` · `email` · `number` · `checkbox` · `date` · `select` · `radio` · `relationship` · `upload` · `image` · `url` · `array` · `blocks` · `structural-array`

Custom renderers register via the plugin system:

```ts
import { LivePreviewClient } from '@relative23/payload-live-preview';

const client = new LivePreviewClient({ allowedOrigins: ['https://admin.example.com'] });
await client.use({
  name: 'currency',
  init: (ctx) => {
    ctx.registerFieldRenderer({
      name: 'text',
      render: (target, value) => {
        target.element.textContent = new Intl.NumberFormat('de-AT', {
          style: 'currency',
          currency: 'EUR',
        }).format(Number(value));
      },
    });
  },
});
```

## Security model

- **Origin validation** — every incoming `postMessage` is checked against an allow-list assembled from explicit origins, `document.referrer`, and (in dev) a localhost pattern. After the first valid handshake the detector locks to that exact origin.
- **HTML sanitisation** — Lexical output and HTML-typed fields run through an isomorphic DOM sanitiser with a curated tag/attribute whitelist (includes `<img>`, `<figure>`, `<video>` for media; rejects `<script>`, `<form>`, `<iframe>`, `<svg>`, inline event handlers, `style` attributes).
- **URL validation** — every URL that lands in `href`/`src`/`srcset`/`poster` must match `http(s)` / `mailto:` / `tel:` / relative; `javascript:`, `data:`, `vbscript:`, `file:`, `blob:` are explicitly rejected (case-insensitive, even with leading whitespace).
- **CSP-friendly** — every adapter generates a per-request nonce and assembles `script-src 'self' 'nonce-…' 'strict-dynamic'` so consumers can drop `unsafe-inline` entirely. `frame-ancestors` is built automatically.
- **No prototype pollution** — nested field lookups refuse `__proto__`, `prototype`, `constructor`.

## License

MIT
