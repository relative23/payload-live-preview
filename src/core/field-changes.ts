/**
 * The one per-message diff of top-level field values. Strategies, dependency
 * invalidation and reveal all consume it, so "changed" means the same thing
 * everywhere.
 */

import type { DependencyMap } from './dependencies';
import { valueIdentity } from './value-identity';

export interface FieldChanges {
  /** Fields whose value differs from the previous message; every field on the first one. */
  readonly changed: ReadonlySet<string>;
  /** Dependents of changed fields, per the dependency map. */
  readonly invalidated: ReadonlySet<string>;
}

export class FieldChangeTracker {
  private previous: Map<string, string | undefined> | null = null;

  /** Diff `fields` against the previous message and remember them for the next call. */
  diff(fields: Readonly<Record<string, unknown>>, dependencies: DependencyMap): FieldChanges {
    const previous = this.previous;
    const next = new Map<string, string | undefined>();
    const changed = new Set<string>();
    for (const [name, value] of Object.entries(fields)) {
      const identity = valueIdentity(value);
      next.set(name, identity);
      // A value without an identity always counts as changed: rendering once
      // more is cheap, a stale binding is not.
      if (previous === null || identity === undefined || previous.get(name) !== identity) {
        changed.add(name);
      }
    }
    if (previous !== null) {
      for (const name of previous.keys()) if (!next.has(name)) changed.add(name);
    }
    this.previous = next;
    const invalidated = new Set<string>();
    for (const [source, dependents] of Object.entries(dependencies)) {
      if (!changed.has(source)) continue;
      for (const dependent of dependents) invalidated.add(dependent);
    }
    return { changed, invalidated };
  }

  reset(): void {
    this.previous = null;
  }
}
