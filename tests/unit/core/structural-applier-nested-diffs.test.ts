import { describe, expect, it } from 'vitest';
import { applyStructuralPatches, KEY_ATTRIBUTE } from '@core/structural-applier';
import { diffArray } from '@schema/diff';
import { store } from './structural-applier-harness';

describe('applyStructuralPatches — nested diffs and rebuilds', () => {
  it('supports deeply nested arrays (3 levels)', () => {
    const deepTemplate =
      '<li>{{title}}<ul data-payload-nested-key="sections" ' +
      'data-payload-nested-template="' +
      '&lt;li&gt;{{name}}&lt;ul data-payload-nested-key=&quot;items&quot; ' +
      'data-payload-nested-template=&quot;&amp;lt;span&amp;gt;{{label}}&amp;lt;/span&amp;gt;&quot;&gt;&lt;/ul&gt;&lt;/li&gt;' +
      '"></ul></li>';
    const next = [
      {
        id: 'root',
        title: 'Root',
        sections: [
          {
            id: 's1',
            name: 'Sec 1',
            items: [
              { id: 'i1', label: 'one' },
              { id: 'i2', label: 'two' },
            ],
          },
        ],
      },
    ];
    const ul = document.createElement('ul');
    applyStructuralPatches({
      store,
      template: deepTemplate,
      container: ul,
      patches: diffArray([], next),
      nextItems: next,
    });
    const i1 = ul.querySelector(`[${KEY_ATTRIBUTE}="i1"]`);
    const i2 = ul.querySelector(`[${KEY_ATTRIBUTE}="i2"]`);
    expect(i1?.textContent).toBe('one');
    expect(i2?.textContent).toBe('two');
  });
});
