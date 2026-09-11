/**
 * The pages and keystroke patterns the interaction gate replays, and the
 * server model it merges against.
 *
 * A scenario is one preview page plus the sequence of update messages a typing
 * editor produces on it. Every message after the first carries
 * `externallyUpdatedRelationship`, because Payload's panel attaches that event
 * to every message once the document has autosaved once — measuring without it
 * measures a situation that is over two minutes into a real editing session.
 */

/** The audit's typing pattern: 18 keystrokes, 30 ms apart. */
export const KEYSTROKES = 18;
export const KEYSTROKE_INTERVAL_MS = 30;

export interface LatencyProbe {
  /** The bound element whose change ends the measurement. */
  readonly selector: string;
  /** Text that element carries once the keystroke has arrived, `undefined` while it has not. */
  readonly expect: (step: number) => string;
}

export interface InteractionScenario {
  readonly name: string;
  /** The markup the site's server rendered, bindings included. */
  readonly page: string;
  /** The saved document, posted once before the burst so the burst is an edit. */
  readonly base: Readonly<Record<string, unknown>>;
  /** The document after keystroke `step`. */
  readonly keystroke: (step: number) => Record<string, unknown>;
  /** Absent where the edit has nothing to become visible in — which is itself the finding. */
  readonly probe?: LatencyProbe;
  /**
   * Give this page the real route strategy, with its HTML answered locally, and
   * count what one burst of typing costs it. Only the scenario whose finding is
   * about the route asks for it: the strategy changes what the other four do.
   */
  readonly routeStrategy?: true;
  /**
   * Run the client with `autoBind: 'unique'` (ADR 0014). The page then carries
   * no `data-payload-field` at all, and the first message has to find the
   * bindings the other scenarios declare — once, at a cost this gate states.
   */
  readonly autoBind?: 'unique';
  readonly why: string;
}

/** The saved document, cut to the fields each page actually binds. */
const SAVED = {
  id: 1,
  title: 'Hello from the demo',
  subtitle: 'Type in the admin panel to see live updates.',
  count: 12,
} as const;

const HEADLINE = { id: SAVED.id, title: SAVED.title } as const;

const BOUND_PAGE = `
  <article>
    <h1 data-payload-field="title">Hello from the demo</h1>
    <p data-payload-field="subtitle">Type in the admin panel to see live updates.</p>
    <span data-payload-field="count" data-payload-type="number">12</span>
  </article>`;

/** A Lexical root whose one paragraph carries the edited text. */
function lexicalBody(text: string): Record<string, unknown> {
  return {
    root: {
      type: 'root',
      children: [
        {
          type: 'heading',
          tag: 'h2',
          children: [{ type: 'text', text: 'Rich text from Lexical' }],
        },
        { type: 'paragraph', children: [{ type: 'text', text }] },
      ],
    },
  };
}

export const TEXT_FIELD: InteractionScenario = {
  name: 'plain text field',
  page: BOUND_PAGE,
  base: SAVED,
  keystroke: (step) => ({ ...SAVED, title: `Hello from the demo ${step}` }),
  probe: { selector: '[data-payload-field="title"]', expect: (step) => `demo ${step}` },
  why: 'the commonest edit there is: one scalar the page already shows, needing nothing from the server',
};

export const RICH_TEXT: InteractionScenario = {
  name: 'rich text field',
  page: `
    <article>
      <h1 data-payload-field="title">Hello from the demo</h1>
      <div data-payload-field="body" data-payload-type="richText">
        <h2>Rich text from Lexical</h2><p>Intro words here</p>
      </div>
    </article>`,
  base: { ...HEADLINE, body: lexicalBody('Intro words here') },
  keystroke: (step) => ({ ...HEADLINE, body: lexicalBody(`Intro words here ${step}`) }),
  probe: { selector: '[data-payload-field="body"]', expect: (step) => `here ${step}` },
  why: 'the largest per-keystroke render in the runtime: a whole Lexical tree re-rendered and sanitised',
};

export const RELATIONSHIP_FIELD: InteractionScenario = {
  name: 'relationship field',
  page: `
    <article>
      <h1 data-payload-field="title">Hello from the demo</h1>
      <a data-payload-field="author" data-payload-type="relationship" href="/authors/1">Ada Lovelace</a>
    </article>`,
  base: { ...HEADLINE, author: 1 },
  // The admin posts a bare id; only the merged document carries the label the
  // page shows. This is the one scenario whose request buys something.
  keystroke: (step) => ({ ...HEADLINE, author: 100 + step }),
  probe: { selector: '[data-payload-field="author"]', expect: (step) => `Author ${100 + step}` },
  why: 'the field whose request is earned: without the merge the page can only show an id',
};

export const UNBOUND_FIELD: InteractionScenario = {
  name: 'unbound field on a bound page',
  page: BOUND_PAGE,
  base: { ...SAVED, seoTitle: 'Demo' },
  keystroke: (step) => ({ ...SAVED, seoTitle: `Demo ${step}` }),
  why: 'nothing on the page can show this field, so every request the edit costs is spent on nothing',
};

/**
 * LP-5. The page binds three fields and the editor types into a fourth, so the
 * only honest answer is the server's own render of the route. The strategy
 * paces that at one refresh per second; what the audit measured was that
 * everything inside the second was simply dropped, so the change that ended a
 * burst never arrived. The count here is what a burst may cost *and* the proof
 * that its last keystroke still reaches the preview.
 */
export const UNBOUND_FIELD_WITH_ROUTE: InteractionScenario = {
  name: 'unbound field on a page that refreshes its route',
  page: BOUND_PAGE,
  base: { ...SAVED, seoTitle: 'Demo' },
  keystroke: (step) => ({ ...SAVED, seoTitle: `Demo ${step}` }),
  routeStrategy: true,
  why: 'LP-5: the keystroke that ends a burst is the one the brake used to swallow',
};

/**
 * The bound page with every attribute removed and a body's worth of other text
 * around it: 1 000 paragraphs the search has to read and reject, the way a
 * long article, a navigation and a footer would surround the three fields on
 * a real page. The keystroke after the first message is the plain-text row's
 * keystroke — a guessed binding is a binding — and the number this row adds is
 * what that first message costs.
 */
export const AUTO_BOUND_PAGE: InteractionScenario = {
  name: 'auto-bound page',
  page: `
    <article>
      <h1>Hello from the demo</h1>
      <p>Type in the admin panel to see live updates.</p>
      <span>12</span>
    </article>
    <section>${Array.from({ length: 1_000 }, (_, i) => `<p>Paragraph ${String(i)} of the surrounding page, which the search reads and rejects.</p>`).join('')}</section>`,
  base: SAVED,
  keystroke: (step) => ({ ...SAVED, title: `Hello from the demo ${step}` }),
  probe: { selector: 'article > h1', expect: (step) => `demo ${step}` },
  autoBind: 'unique',
  why: 'ADR 0014, F3: what the one search on the first message costs, on a page with a body around the fields',
};

export const PAGE_WITHOUT_BINDINGS: InteractionScenario = {
  name: 'page without bindings',
  page: `
    <article>
      <h1>Hello from the demo</h1>
      <p>Type in the admin panel to see live updates.</p>
    </article>`,
  base: SAVED,
  keystroke: (step) => ({ ...SAVED, title: `Hello from the demo ${step}` }),
  why: 'LP-4 measured 19 authenticated POSTs from a page whose binding count was zero',
};

export const SCENARIOS: readonly InteractionScenario[] = [
  TEXT_FIELD,
  RICH_TEXT,
  RELATIONSHIP_FIELD,
  UNBOUND_FIELD,
  UNBOUND_FIELD_WITH_ROUTE,
  PAGE_WITHOUT_BINDINGS,
  AUTO_BOUND_PAGE,
];

/**
 * The merge endpoint modelled: Payload returns the posted form values with
 * relationships and uploads resolved. Only `author` is a relation here, and
 * resolving it is the whole reason the request exists — a runtime that stops
 * making it must still make this one.
 */
export function populate(data: Record<string, unknown>): Record<string, unknown> {
  const author = data['author'];
  if (typeof author !== 'number') return data;
  return { ...data, author: { id: author, title: `Author ${author}` } };
}
