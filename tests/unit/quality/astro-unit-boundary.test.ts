/**
 * The Node unit runner cannot compile native Astro templates.
 * Its dependency walk must understand that boundary without allowing an
 * unmocked template to masquerade as a successful component render.
 */
import { expect, it, vi } from 'vitest';

vi.unmock('@adapters/astro/FragmentBridge.astro');

it('requires the native compiler when the internal Astro template is not mocked', async () => {
  await expect(import('@adapters/astro/FragmentBridge.astro')).rejects.toThrow(
    'FragmentBridge.astro requires the native Astro compiler; mock it only in unit tests',
  );
});
