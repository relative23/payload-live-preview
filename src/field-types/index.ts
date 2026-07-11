/**
 * Public barrel for built-in field renderers.
 *
 * Each renderer is imported as a named binding (not a side-effect)
 * and assembled into the registry through `buildBuiltinRenderers`.
 * The bundler keeps every reference reachable, so the registry is
 * fully populated at runtime even under `sideEffects: false`.
 *
 * @module @field-types
 */

import type { FieldRenderer } from '@core/types';
import { textRenderer } from './text';
import { textareaRenderer } from './textarea';
import { richTextRenderer } from './rich-text';
import { htmlRenderer } from './html';
import { urlRenderer } from './url';
import { imageRenderer } from './image';
import { uploadRenderer } from './upload';
import { relationshipRenderer } from './relationship';
import { selectRenderer } from './select';
import { checkboxRenderer } from './checkbox';
import { dateRenderer } from './date';
import { numberRenderer } from './number';
import { arrayRenderer } from './array';
import { structuralArrayRenderer } from './structural-array';
import {
  buildBuiltinRenderers as buildRegistry,
  registerBuiltinRenderer,
  __resetBuiltinRenderersForTests,
} from './registry';

const BUILTIN: readonly FieldRenderer[] = [
  textRenderer,
  textareaRenderer,
  richTextRenderer,
  htmlRenderer,
  urlRenderer,
  { ...urlRenderer, name: 'email' },
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
  structuralArrayRenderer,
];

/**
 * Built-in renderer map. Calling this from the runtime adds every
 * concrete renderer to the registry and snapshots the result.
 */
export function buildBuiltinRenderers(): Readonly<Record<string, FieldRenderer>> {
  return buildRegistry(BUILTIN);
}

export { registerBuiltinRenderer, __resetBuiltinRenderersForTests };
export type { PayloadMedia, PayloadRelationship } from './types';
