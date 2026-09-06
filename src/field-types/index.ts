/** Built-in field renderers, assembled as values so `sideEffects: false` bundlers keep them all. */

import type { FieldRenderer } from '@core/types';
import { createTextRenderer } from './text';
import { richTextRenderer } from './rich-text';
import { htmlRenderer } from './html';
import { urlRenderer } from './url';
import { emailRenderer } from './email';
import { imageRenderer } from './image';
import { uploadRenderer } from './upload';
import { relationshipRenderer } from './relationship';
import { selectRenderer } from './select';
import { checkboxRenderer } from './checkbox';
import { dateRenderer } from './date';
import { numberRenderer } from './number';
import { arrayRenderer } from './array';
import { createStructuralArrayRenderer } from './structural-array';
import {
  buildBuiltinRenderers as buildRegistry,
  registerBuiltinRenderer,
  __resetBuiltinRenderersForTests,
} from './registry';
import { reportOmittedFeature } from '@core/profile';

/**
 * The array renderers carry the keyed morph, the structural applier and the item
 * templates — the largest optional cluster in the runtime. The lean profile
 * answers a page that needs them with LP0104 instead (@core/profile).
 */
function arrayRenderers(): readonly FieldRenderer[] {
  return typeof __LEAN_BUILD__ !== 'undefined' && __LEAN_BUILD__
    ? [
        omittedRenderer('array', 'structural arrays'),
        omittedRenderer('blocks', 'structural arrays'),
      ]
    : [arrayRenderer, { ...arrayRenderer, name: 'blocks' }];
}

/** A renderer that only explains itself: the lean profile does not carry this field type. */
function omittedRenderer(name: FieldRenderer['name'], feature: 'structural arrays'): FieldRenderer {
  return {
    name,
    render() {
      reportOmittedFeature(feature);
    },
  };
}

/** One renderer map per client; the stateful text and structural renderers are created fresh each call. */
export function buildBuiltinRenderers(): Readonly<Record<string, FieldRenderer>> {
  // Built per call: a module-level table would pin every renderer into any
  // consumer importing an unrelated symbol from the root barrel.
  const stateless: readonly FieldRenderer[] = [
    richTextRenderer,
    htmlRenderer,
    urlRenderer,
    emailRenderer,
    imageRenderer,
    uploadRenderer,
    relationshipRenderer,
    selectRenderer,
    { ...selectRenderer, name: 'radio' },
    checkboxRenderer,
    dateRenderer,
    numberRenderer,
    ...arrayRenderers(),
  ];

  return buildRegistry([
    createTextRenderer('text'),
    createTextRenderer('textarea'),
    ...stateless,
    ...(typeof __LEAN_BUILD__ !== 'undefined' && __LEAN_BUILD__
      ? []
      : [createStructuralArrayRenderer()]),
  ]);
}

export { registerBuiltinRenderer, __resetBuiltinRenderersForTests };
export type { PayloadMedia, PayloadRelationship } from './types';
