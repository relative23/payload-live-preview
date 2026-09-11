/**
 * The mutations the fidelity oracle replays, and the differences it is allowed
 * to find today.
 *
 * A case is one document state posted into a live page whose server can render
 * the same state, so the two can be held against each other. The ledger below
 * is the ratchet: every difference the oracle finds must be written here with
 * the work item that removes it, and a line that stops occurring fails the gate
 * just as loudly as a new one — an exception nobody deletes is an exception
 * nobody fixes.
 */

/** The values `examples/astro-payload/src/pages/index.astro` rendered at build time. */
const STATIC_DOCUMENT = {
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
  body: {
    root: {
      children: [
        {
          type: 'heading',
          tag: 'h2',
          children: [{ type: 'text', text: 'Rich text from Lexical' }],
        },
        {
          type: 'paragraph',
          children: [
            { type: 'text', text: 'Mix of ' },
            { type: 'text', text: 'bold', format: 1 },
            { type: 'text', text: ', ' },
            { type: 'text', text: 'italic', format: 2 },
            { type: 'text', text: ', and ' },
            {
              type: 'link',
              url: 'https://example.com',
              children: [{ type: 'text', text: 'links' }],
            },
            { type: 'text', text: '.' },
          ],
        },
      ],
    },
  },
} as const;

/**
 * A Lexical root whose second node only `examples/astro-hybrid` knows: the site
 * registers `callout` on the server, and no browser runtime can register it
 * through the inline path. It is the shape of the finding that started this
 * gate — a server render carrying markup a patch has no way to reproduce.
 */
const SERVER_ONLY_NODE = {
  body: {
    root: {
      type: 'root',
      children: [
        { type: 'paragraph', children: [{ type: 'text', text: 'Intro words here' }] },
        { type: 'callout', text: 'Only the server knows this node' },
      ],
    },
  },
} as const;

export interface FidelityCase {
  readonly name: string;
  /** Posted as the update message's `data`. */
  readonly fields: Readonly<Record<string, unknown>>;
  /**
   * Field names this message changes. Their bound elements are excluded from
   * the comparison: the server renders the saved document, so it is behind
   * there by design and only the untouched page has a truth to be held to.
   */
  readonly changedFields: readonly string[];
  readonly why: string;
}

/**
 * The connection's first message. It describes the state the server already
 * rendered, which is what makes the message after it an edit rather than a
 * first impression.
 */
export const STATIC_BASELINE: FidelityCase = {
  name: 'static page, the state the server already rendered',
  fields: STATIC_DOCUMENT,
  changedFields: [],
  why: 'the first message of a connection is the saved document, not an edit',
};

/**
 * One edited field, and the relationship event Payload's panel attaches to
 * every message once the document has autosaved. That event turns the runtime's
 * "unchanged fields need no work" off, so the whole document is written over
 * markup the server already got right — exactly the situation in which a
 * renderer's shortcomings become visible.
 */
export const STATIC_FORCED_RENDER: FidelityCase = {
  name: 'static page, one edited field, every other field re-rendered',
  fields: { ...STATIC_DOCUMENT, title: 'An edited title' },
  changedFields: ['title'],
  why: 'a re-render of unchanged fields must reproduce the server byte for byte',
};

/** The same revision, rendered by the site's own server through the fragment endpoint. */
export const SSR_FRAGMENT_RENDER: FidelityCase = {
  name: 'SSR boundary, the server rendered the revision',
  fields: SERVER_ONLY_NODE,
  changedFields: [],
  why: 'the boundary the server rendered is the standard every other path is measured against',
};

/**
 * The same revision once more, with the endpoint refusing it. A patch cannot
 * produce the site's own Lexical node, and the one thing it must therefore not
 * do is write anyway: the boundary has to be left standing as the server built
 * it. That is measured against the server's render of the baseline document,
 * because "unchanged" is a claim about markup, not about intent.
 */
export const SSR_REFUSED_RENDER: FidelityCase = {
  name: 'SSR boundary, the server refused the revision',
  fields: SERVER_ONLY_NODE,
  changedFields: [],
  why: 'a revision the runtime cannot render must leave the server version untouched',
};

export interface KnownDivergence {
  /** The `name` of the case that produces it. */
  readonly case: string;
  /** `kind|path` as `compareFidelity` reports it. */
  readonly signature: string;
  /**
   * The maintainer work item that removes this line. An entry without one is a
   * defect in the gate, not a documented limitation — the oracle asserts it.
   */
  readonly task: string;
  readonly why: string;
}

/**
 * Today's differences, one line each. Deleting a line is the whole ceremony for
 * declaring one fixed, and the oracle refuses a line that no longer describes a
 * difference it can find.
 */
export const KNOWN_DIVERGENCES: readonly KnownDivergence[] = [
  {
    case: STATIC_FORCED_RENDER.name,
    signature: 'text|article > p > time[field=publishedAt] > #text:1',
    // Moved from Z3 to Z20 once Z3 had measured it. Escalating is what Z3 does
    // to a patch it cannot make faithfully, and this patch is made: the runtime
    // writes the ISO string successfully. Escalation then makes it worse rather
    // than better — the route redraws the server's format and the re-apply
    // overwrites it again — so what is needed is a diagnostic naming
    // `data-payload-format`, which is Z20.
    task: 'Z20',
    // Z20 made it audible without making it go away, which is the right order:
    // the runtime cannot pick between the two formats, so it names both and
    // points at the attribute that decides. The line leaves when a
    // `data-payload-format` on this `<time>` makes the two agree.
    why: 'the server printed the stored ISO string and the date renderer prints a formatted one; the runtime cannot know how the template formatted a value, and escalating overwrites the server format a second time instead of keeping it. Reported since Z20 as LP0412 on the first write to the binding; the difference itself only goes away once the markup carries data-payload-format',
  },
];

/** Work items an exception may name; the oracle rejects any other value. */
export const TASKS_THAT_REMOVE_EXCEPTIONS = [
  'Z2',
  'Z3',
  'Z4',
  'Z5',
  'Z6',
  'Z7',
  'Z20',
  'Z22',
] as const;
