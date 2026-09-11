/**
 * The trap corpus for auto-binding (ADR 0014, F1): pages on which a field's
 * value stands somewhere it must not be bound to.
 *
 * Every trap is a page where the correct number of guessed bindings is zero.
 * The dangerous class is not ambiguity, which fails closed by itself; it is a
 * value that occurs exactly once and in the wrong place — the year in the
 * copyright line, the city in the footer address — and the rules that keep the
 * runtime out of those are what this corpus measures. A trap that starts
 * binding is a wrong write on every keystroke, and the test that replays the
 * corpus holds the page against the markup the server sent.
 */

export interface AutoBindTrap {
  readonly name: string;
  /** The `<body>` the server rendered. */
  readonly html: string;
  /** Markup for `<head>`, when the trap is about a head element. */
  readonly head?: string;
  /** The saved document, as the connection's first message carries it. */
  readonly fields: Readonly<Record<string, unknown>>;
  /** DOM the markup cannot express, attached before the runtime starts. */
  readonly mount?: (body: HTMLElement) => void;
  readonly why: string;
}

const TITLE = 'Hello from the demo';

/**
 * Each region the search must never enter, with the value standing there
 * exactly once so that only the exclusion keeps it out. Generated rather than
 * written out, so adding a region is one line and cannot forget the document.
 */
const EXCLUDED_REGIONS: readonly (readonly [name: string, html: string, why: string])[] = [
  ['a script', `<script type="text/plain">${TITLE}</script>`, 'script text is code, not content'],
  ['a style element', `<style>${TITLE}</style>`, 'style text is a stylesheet'],
  ['a template', `<template><h1>${TITLE}</h1></template>`, 'template content is inert'],
  [
    'a noscript element',
    `<noscript>${TITLE}</noscript>`,
    'noscript text renders only without scripting',
  ],
  ['a textarea', `<textarea>${TITLE}</textarea>`, 'a form control holds a value, not content'],
  [
    'an input value',
    `<input value="${TITLE}">`,
    'a form value is the visitor’s, not the document’s',
  ],
  ['a select option', `<select><option>${TITLE}</option></select>`, 'an option is a form value'],
  [
    'a contenteditable subtree',
    `<div contenteditable="true"><p>${TITLE}</p></div>`,
    'an editable region belongs to whoever is editing it',
  ],
  [
    'an opted-out subtree',
    `<section data-payload-no-bind><h1>${TITLE}</h1></section>`,
    'data-payload-no-bind is the author saying no',
  ],
  [
    'an owned subtree',
    `<div data-payload-owned><h1>${TITLE}</h1></div>`,
    'data-payload-owned is a subtree the site scripts itself',
  ],
  [
    'an island',
    `<astro-island><h1>${TITLE}</h1></astro-island>`,
    'a hydrated island owns its subtree (ADR 0008 §4)',
  ],
  [
    'an SVG',
    `<svg xmlns="http://www.w3.org/2000/svg"><text>${TITLE}</text></svg>`,
    'the renderers write HTML, not SVG',
  ],
];

export const AUTO_BIND_TRAPS: readonly AutoBindTrap[] = [
  {
    name: 'the year in the copyright line',
    html: '<footer><p>© <span>2024</span> Example GmbH</p></footer>',
    fields: { year: '2024' },
    why: 'digits match by accident; a year field must never rewrite the footer',
  },
  {
    name: 'the city in the footer address',
    html: '<footer><address>Musterstraße 1<br><span>Berlin</span></address></footer>',
    fields: { city: 'Berlin' },
    why: 'a short word occurs once and in the wrong place; the template never printed the field',
  },
  {
    name: 'a longer city, still only in the footer',
    html: '<footer><address><span>Hamburg</span></address></footer>',
    fields: { city: 'Hamburg' },
    why: 'the same class one character longer; the floor has to hold here too',
  },
  {
    name: 'a title that is also the link text in the navigation',
    html: `<nav><a href="/">${TITLE}</a></nav><main><h1>${TITLE}</h1></main>`,
    fields: { title: TITLE },
    why: 'two elements carry the value; binding either would be a coin flip, so neither is bound',
  },
  {
    name: 'an author name that only a related post prints',
    html: '<aside><h2>Related</h2><p class="byline">Ada Lovelace</p></aside>',
    fields: { author: 'Ada Lovelace' },
    why: 'the template never printed the field; the name belongs to another document',
  },
  {
    name: 'a label that only another link carries',
    html: '<aside><a href="/other">Read more</a></aside>',
    fields: { ctaLabel: 'Read more' },
    why: 'a generic label recurs across a page; the template never printed the field',
  },
  {
    name: 'enum tokens, a locale code, a boolean and a number',
    html:
      '<p><span>published</span> · <span>wide</span> · <span>de-AT</span> · ' +
      '<span>true</span> · <span>49</span> · <span>1.299,00</span></p>',
    fields: {
      state: 'published',
      layout: 'wide',
      language: 'de-AT',
      featured: true,
      price: 49,
      priceLabel: '1.299,00',
    },
    why: 'tokens, codes and numbers are the values that match by accident',
  },
  {
    name: 'a partial match and one split across nodes',
    html: `<h1>Hello from the <em>demo</em></h1><p>${TITLE}!</p>`,
    fields: { title: TITLE },
    why: 'neither node holds the whole value on its own',
  },
  {
    name: 'a text node with an element beside it',
    html: `<p>${TITLE} <a href="/more">more</a></p>`,
    fields: { title: TITLE },
    why: 'a text write there would destroy the link next to it',
  },
  {
    name: 'the value as text and as an attribute of two different elements',
    html: `<button data-analytics-label="${TITLE}">Open</button><h1>${TITLE}</h1>`,
    fields: { title: TITLE },
    why: 'an attribute counts as an occurrence; two occurrences are ambiguous',
  },
  {
    name: 'the same URL on two links',
    html:
      '<header><a href="https://payloadcms.com">Site</a></header>' +
      '<footer><a href="https://payloadcms.com">Site</a></footer>',
    fields: { ctaUrl: 'https://payloadcms.com' },
    why: 'two attributes carry the value',
  },
  {
    name: 'the same alt text on two images',
    html: '<img src="/a.jpg" alt="Mountains at dusk"><img src="/b.jpg" alt="Mountains at dusk">',
    fields: { hero: { alt: 'Mountains at dusk' } },
    why: 'a thumbnail repeats the hero’s alt text',
  },
  {
    name: 'two fields with the same value and one element',
    html: `<h1>${TITLE}</h1>`,
    fields: { title: TITLE, seoTitle: TITLE },
    why: 'the element is unique but the field is not; the runtime cannot know which one it renders',
  },
  {
    name: 'a declared binding on the element, for another field',
    html: `<h1 data-payload-field="subtitle">${TITLE}</h1>`,
    fields: { title: TITLE },
    why: 'an explicit data-payload-field wins as a veto: the element is spoken for',
  },
  {
    name: 'a match inside a declared binding’s subtree',
    html: `<div data-payload-field="body" data-payload-richtext><h2>${TITLE}</h2></div>`,
    fields: { title: TITLE },
    why: 'the declared binding owns its subtree and will rewrite it',
  },
  {
    name: 'a meta tag in the head',
    head: `<meta property="og:title" content="${TITLE}">`,
    html: '<main><p>Nothing here matches.</p></main>',
    fields: { title: TITLE },
    why: 'the search stays in the body; a head binding needs the attribute and the route strategy',
  },
  {
    name: 'a populated relationship',
    html: '<p class="byline">Ada Lovelace</p>',
    fields: { author: { id: 7, name: 'Ada Lovelace' } },
    why: 'a document with an id is another document, not a group of this one’s scalars',
  },
  {
    name: 'the fields Payload ships with every document',
    html: '<p>abc123def456</p><p>2025-04-12T08:30:00.000Z</p>',
    fields: { id: 'abc123def456', _status: 'draft', updatedAt: '2025-04-12T08:30:00.000Z' },
    why: 'system fields are never bound, declared or guessed',
  },
  {
    name: 'a shadow root',
    html: '<div id="host"></div>',
    fields: { title: TITLE },
    mount: (body) => {
      const host = body.querySelector('#host');
      if (host === null) throw new Error('the trap has no host');
      host.attachShadow({ mode: 'open' }).innerHTML = `<h1>${TITLE}</h1>`;
    },
    why: 'a shadow tree is a component’s own; the search does not pierce it',
  },
  ...EXCLUDED_REGIONS.map(([name, html, why]): AutoBindTrap => ({
    name: `the value inside ${name}`,
    html,
    fields: { title: TITLE },
    why,
  })),
];

/** The second message: every scalar edited, so a binding that should not exist would write. */
export function editedFields(fields: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const edited: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(fields)) {
    if (typeof value === 'string') edited[name] = `${value} (edited)`;
    else if (typeof value === 'number') edited[name] = value + 1;
    else if (typeof value === 'boolean') edited[name] = !value;
    else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      edited[name] = editedFields(value as Record<string, unknown>);
    } else edited[name] = value;
  }
  return edited;
}
