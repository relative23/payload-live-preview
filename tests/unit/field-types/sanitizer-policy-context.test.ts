/**
 * `RenderContext.sanitizerPolicy` is the instance's policy (ADR 0002): every
 * renderer that writes HTML sanitises with it, and without one the process
 * default set by `setSanitizerPolicy()` applies.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { __resetBlockRegistryForTests, registerBlockRenderer } from '@lexical/blocks/registry';
import { setSanitizerPolicy, type SanitizerPolicyMode } from '@security/sanitizer';
import type { RenderContext, RichTextRenderer } from '@core/types';
import { emptyContext, makeTarget, rendererNamed } from './helpers';

afterEach(() => {
  setSanitizerPolicy('strict');
  __resetBlockRegistryForTests();
});

// `data-track` passes under compat and is stripped under strict, in rich text
// and in an item template alike.
const MARKED = '<p data-track="cta">t</p>';
const TEMPLATE = '<li data-track="cta">{{label}}</li>';

// [process default, instance policy, whether data-track survives]
const CASES = [
  ['strict', undefined, false],
  ['compat', undefined, true],
  ['compat', 'strict', false],
  ['strict', 'compat', true],
] as const;

function contextWith(policy: SanitizerPolicyMode | undefined): RenderContext {
  return policy === undefined ? emptyContext() : { ...emptyContext(), sanitizerPolicy: policy };
}

function kept(element: Element): boolean {
  return element.querySelector('[data-track]') !== null;
}

describe.each([
  ['html', {}, MARKED],
  ['richText', {}, MARKED],
  ['array', { arrayTemplate: TEMPLATE }, [{ label: 'x' }]],
  ['blocks', { arrayTemplate: TEMPLATE }, [{ label: 'x' }]],
  [
    'structural-array',
    { fieldType: 'structural-array', arrayTemplate: TEMPLATE },
    [{ id: 1, label: 'x' }],
  ],
] as const)('%s renderer', (name, overrides, value) => {
  it.each(CASES)(
    'process %s, instance %s → data-track kept: %s',
    (processPolicy, instancePolicy, expected) => {
      setSanitizerPolicy(processPolicy);
      const el = document.createElement(name === 'structural-array' ? 'ul' : 'div');
      rendererNamed(name).render(makeTarget(el, overrides), value, contextWith(instancePolicy));
      expect(kept(el)).toBe(expected);
    },
  );
});

describe('richText renderer — the project and Lexical paths', () => {
  it.each(CASES)(
    'renderRichText output: process %s, instance %s → data-track kept: %s',
    (processPolicy, instancePolicy, expected) => {
      setSanitizerPolicy(processPolicy);
      const renderRichText: RichTextRenderer = () => MARKED;
      const el = document.createElement('div');
      rendererNamed('richText').render(makeTarget(el), 'ignored', {
        ...contextWith(instancePolicy),
        renderRichText,
      });
      expect(kept(el)).toBe(expected);
    },
  );

  // A block renderer is project code whose string Lexical hands back as is;
  // the sink sanitises it, so the instance policy has to reach that path too.
  it.each(CASES)(
    'a custom block: process %s, instance %s → data-track kept: %s',
    (processPolicy, instancePolicy, expected) => {
      setSanitizerPolicy(processPolicy);
      registerBlockRenderer('tracked', () => MARKED);
      const el = document.createElement('div');
      rendererNamed('richText').render(
        makeTarget(el),
        { root: { children: [{ type: 'block', fields: { blockType: 'tracked' } }] } },
        contextWith(instancePolicy),
      );
      expect(kept(el)).toBe(expected);
    },
  );
});
