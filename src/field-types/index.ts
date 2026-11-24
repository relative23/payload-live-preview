/** The built-in renderer table a client starts from, and the seam a project registers its own through. */

export { buildBuiltinRenderers } from './builtin-renderers';
export { registerBuiltinRenderer, __resetBuiltinRenderersForTests } from './registry';
export type { PayloadMedia, PayloadRelationship } from './types';
