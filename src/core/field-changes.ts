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
  /**
   * The first message of a connection, where `changed` means "everything the
   * document has" rather than "what the editor just did". A caller that acts on
   * a change rather than rendering one has to sit this message out.
   */
  readonly baseline: boolean;
}

export class FieldChangeTracker {
  private previous: Map<string, string | undefined> | null = null;

  get isBaseline(): boolean {
    return this.previous === null;
  }

  /** Diff `fields` against the previous message and remember them for the next call. */
  diff(fields: Readonly<Record<string, unknown>>, dependencies: DependencyMap): FieldChanges;
  diff(
    fields: Readonly<Record<string, unknown>>,
    dependencies: DependencyMap,
    isCurrent: () => boolean,
  ): FieldChanges | null;
  diff(
    fields: Readonly<Record<string, unknown>>,
    dependencies: DependencyMap,
    isCurrent: () => boolean = alwaysCurrent,
  ): FieldChanges | null {
    const previous = this.previous;
    const baseline = previous === null;
    const next = new Map<string, string | undefined>();
    const changed = new Set<string>();
    const entries = Object.entries(fields);
    if (!isCurrent()) return null;
    for (const [name, value] of entries) {
      const identity = valueIdentity(value);
      if (!isCurrent()) return null;
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
    const invalidated = new Set<string>();
    const dependencyEntries = Object.entries(dependencies);
    if (!isCurrent()) return null;
    for (const [source, dependents] of dependencyEntries) {
      if (!changed.has(source)) continue;
      for (const dependent of dependents) {
        invalidated.add(dependent);
        if (!isCurrent()) return null;
      }
    }
    if (!isCurrent()) return null;
    this.previous = next;
    return { changed, invalidated, baseline };
  }

  reset(): void {
    this.previous = null;
  }
}

function alwaysCurrent(): boolean {
  return true;
}
