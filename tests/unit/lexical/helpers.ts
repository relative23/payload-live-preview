import type { LexicalRoot } from '@lexical/types';

export function makeRoot(children: unknown[]): LexicalRoot {
  return { root: { children: children as unknown as readonly never[] } };
}

export function paragraphWith(...children: unknown[]): LexicalRoot {
  return makeRoot([{ type: 'paragraph', children }]);
}
