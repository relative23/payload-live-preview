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
import { createStructuralArrayRenderer } from './structural-array';
import {
  buildBuiltinRenderers as buildRegistry,
  registerBuiltinRenderer,
  __resetBuiltinRenderersForTests,
} from './registry';

/**
 * The stateless built-in renderers, shared safely across instances.
 * The `structural-array` renderer is intentionally NOT here — it owns
 * per-instance diff state, so it is constructed fresh per build (below).
 */
const STATELESS_BUILTIN: readonly FieldRenderer[] = [
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
];

/**
 * Built-in renderer map. Called once per client/runtime; the
 * `structural-array` renderer gets a fresh instance with its own diff
 * state so nothing is shared between concurrent clients.
 */
export function buildBuiltinRenderers(): Readonly<Record<string, FieldRenderer>> {
  return buildRegistry([...STATELESS_BUILTIN, createStructuralArrayRenderer()]);
}

export { registerBuiltinRenderer, __resetBuiltinRenderersForTests };
export type { PayloadMedia, PayloadRelationship } from './types';
