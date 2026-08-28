/**
 * Plugin compatibility claims. The range grammar is the subset a plugin
 * author writes (`*`, `1.2.3`, `^`, `~`, `>=`, `>`, `<`, `<=`, space-joined
 * conjunctions, `||` alternatives); prerelease tags are ignored.
 */

export interface PluginCompatibility {
  /** A semver range the runtime's `VERSION` must satisfy, e.g. `>=2.0.0`. */
  readonly runtime?: string;
  /** The highest postMessage protocol version the plugin understands. */
  readonly protocol?: number;
}

type Version = readonly [number, number, number];

function parseVersion(text: string): Version | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(text.trim());
  if (match === null) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compare(a: Version, b: Version): number {
  for (let index = 0; index < 3; index += 1) {
    const delta = (a[index] ?? 0) - (b[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

function satisfiesComparator(version: Version, comparator: string): boolean {
  const trimmed = comparator.trim();
  if (trimmed === '' || trimmed === '*') return true;
  const match = /^(\^|~|>=|<=|>|<|=)?\s*v?(\d+)\.(\d+)\.(\d+)/.exec(trimmed);
  if (match === null) return false;
  const operator = match[1] ?? '=';
  const target: Version = [Number(match[2]), Number(match[3]), Number(match[4])];
  const order = compare(version, target);
  switch (operator) {
    case '=':
      return order === 0;
    case '>':
      return order > 0;
    case '>=':
      return order >= 0;
    case '<':
      return order < 0;
    case '<=':
      return order <= 0;
    case '~':
      return order >= 0 && version[0] === target[0] && version[1] === target[1];
    case '^':
      if (order < 0) return false;
      if (target[0] > 0) return version[0] === target[0];
      if (target[1] > 0) return version[0] === 0 && version[1] === target[1];
      return version[0] === 0 && version[1] === 0 && version[2] === target[2];
    default:
      return false;
  }
}

/** Whether `version` satisfies `range`; anything unparsable never satisfies. */
export function satisfiesRange(version: string, range: string): boolean {
  const parsed = parseVersion(version);
  if (parsed === undefined) return false;
  const alternatives = range.split('||');
  return alternatives.some((alternative) => {
    const comparators = alternative
      .trim()
      .split(/\s+/)
      .filter((part) => part.length > 0);
    if (comparators.length === 0) return alternative.trim() === '' && range.trim() === '';
    return comparators.every((comparator) => satisfiesComparator(parsed, comparator));
  });
}

/** Why a plugin was refused, or `undefined` when it fits. */
export function incompatibilityOf(
  compat: PluginCompatibility | undefined,
  runtimeVersion: string,
  protocolVersion: number,
): string | undefined {
  if (compat === undefined) return undefined;
  if (compat.runtime !== undefined && !satisfiesRange(runtimeVersion, compat.runtime)) {
    return `declares runtime ${compat.runtime}, this runtime is ${runtimeVersion}`;
  }
  if (compat.protocol !== undefined) {
    if (!Number.isInteger(compat.protocol) || compat.protocol < 1) {
      return `declares an invalid protocol version ${String(compat.protocol)}`;
    }
    if (compat.protocol < protocolVersion) {
      return `declares protocol ${String(compat.protocol)}, this runtime speaks ${String(protocolVersion)}`;
    }
  }
  return undefined;
}
