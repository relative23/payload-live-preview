/**
 * Registry for the ADR 0019 reference, using the package's document capability.
 * The shared endpoint refuses a mismatched document before this registry runs;
 * the weak map carries only the current request's server-resolved read target.
 */
import {
  createFragmentEndpointHandler,
  type FragmentRenderInput,
} from '@adapters/shared/fragment-endpoint';
import type { AuthorizedPreviewContext } from '@/types/authorized-preview';
import type { ContinuationGrant, createReferenceContinuation } from './preview-continuation';
import { escapeHtml } from '@security/escape';

export function createReferenceFragment(
  reference: ReturnType<typeof createReferenceContinuation>,
  readProps: (
    input: FragmentRenderInput,
    grant: ContinuationGrant,
  ) => Promise<Record<string, unknown>>,
) {
  // Request contexts are weak keys, not a shared verdict cache. The authorizer
  // creates a fresh one on every call; a registry sees only that call's grant.
  const grants = new WeakMap<AuthorizedPreviewContext, ContinuationGrant>();
  return createFragmentEndpointHandler(
    {
      authorizePreview: async (request) => {
        const grant = await reference.authorize(request);
        if (grant === null) return null;
        grants.set(grant.context, grant);
        return grant.context;
      },
      registry: {
        hero: {
          component: {},
          props: (input) => {
            const grant = grants.get(input.authorization);
            if (grant === undefined) throw new Error('reference fragment refused');
            return readProps(input, grant);
          },
        },
      },
      limits: { totalTimeoutMs: 1_000 },
      render: (_component, props) =>
        Promise.resolve(`<h1>${escapeHtml(String(props['title']).toUpperCase())}</h1>`),
    },
    { rendererName: 'reference', render: () => Promise.resolve('') },
  );
}
