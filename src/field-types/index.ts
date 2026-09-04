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
    arrayRenderer,
    { ...arrayRenderer, name: 'blocks' },
  ];

  return buildRegistry([
    createTextRenderer('text'),
    createTextRenderer('textarea'),
    ...stateless,
    createStructuralArrayRenderer(),
  ]);
}

export { registerBuiltinRenderer, __resetBuiltinRenderersForTests };
export type { PayloadMedia, PayloadRelationship } from './types';
