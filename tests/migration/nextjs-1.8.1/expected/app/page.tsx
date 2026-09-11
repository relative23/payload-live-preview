/**
 * Preview target page. Mounted by the mock admin (public/admin.html)
 * and by tests inside an iframe. Every binding is annotated with
 * `data-payload-field` so the live preview engine picks it up
 * automatically.
 *
 * This is a React Server Component: the bound nodes are rendered on
 * the server and never re-rendered by client-side React, so the
 * engine's DOM patches stick. In a real Next.js project the initial
 * values would come from Payload via a server-side fetch; for the
 * example we hard-code them (mirroring examples/astro-payload).
 */
const initial = {
  title: 'Hello from the demo',
  subtitle: 'Type in the admin panel to see live updates.',
  hero: {
    url: 'https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=1200',
    alt: 'Mountains at dusk',
  },
  count: 12,
  publishedAt: '2025-04-12T08:30:00.000Z',
  tags: ['astro', 'payload', 'live-preview'],
  ctaLabel: 'Visit Payload',
  ctaUrl: 'https://payloadcms.com',
};

export default function Page() {
  return (
    <article className="grid">
      <header className="grid">
        <h1 data-payload-field="title">{initial.title}</h1>
        <p data-payload-field="subtitle">{initial.subtitle}</p>
      </header>

      {/* eslint-disable-next-line @next/next/no-img-element -- plain <img> keeps the fixture free of next/image hydration */}
      <img
        data-payload-field="hero"
        data-payload-type="image"
        data-payload-alt="hero.alt"
        src={initial.hero.url}
        alt={initial.hero.alt}
      />

      <div data-payload-field="body" data-payload-richtext="">
        <h2>Rich text from Lexical</h2>
        <p>
          Mix of <strong>bold</strong>, <em>italic</em>, and <a href="https://example.com">links</a>
          .
        </p>
      </div>

      <p>
        Count:{' '}
        <span data-payload-field="count" data-payload-type="number">
          {initial.count}
        </span>
      </p>

      <p>
        Published:{' '}
        <time data-payload-field="publishedAt" dateTime={initial.publishedAt}>
          {initial.publishedAt}
        </time>
      </p>

      <ul
        className="tags"
        data-payload-field="tags"
        data-payload-type="array"
        data-payload-array-template="<li>{{value}}</li>"
      >
        {initial.tags.map((tag) => (
          <li key={tag}>{tag}</li>
        ))}
      </ul>

      <p>
        <a
          data-payload-field="ctaLabel"
          data-payload-href="ctaUrl"
          href={initial.ctaUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          {initial.ctaLabel}
        </a>
      </p>
    </article>
  );
}
