/**
 * Layer, server/browser and cycle rules evaluated against the source graph.
 * The deny-lists are expressed per source domain so a layer may depend on any
 * domain absent from its own list, which keeps the table additive as new
 * domains appear.
 */

import { builtinModules } from 'node:module';
import type { CapabilityKind } from './architecture-capabilities';
import {
  isInternalSourceSpecifier,
  type ArchitectureDependency,
  type ArchitectureModule,
} from './architecture-graph';
import { TRUSTED_CORE_POLICY_FILE, type TrustedCorePolicy } from './trusted-core-policy';

export type ArchitectureViolationKind =
  | 'barrel-logic'
  | 'browser-node-builtin'
  | 'capability'
  | 'layer-boundary'
  | 'runtime-cycle'
  | 'server-boundary'
  | 'unresolved-internal';

export interface ArchitectureViolation {
  readonly kind: ArchitectureViolationKind;
  readonly module: string;
  readonly dependency?: string;
  readonly message: string;
}

/**
 * The zones under `src/` whose code runs on a server, in a build or from the
 * command line, never in a page. The folder is the rule: a module placed in
 * one of them is server-only without an entry in a list.
 */
const SERVER_ONLY_ZONES = new Set(['server', 'tools']);

/**
 * Modules that run at build time inside a framework's own toolchain, though
 * they live in a domain that otherwise ships to browsers. Listing one here says
 * two things at once: it may use Node builtins, and nothing browser-facing may
 * import it — the server-boundary check reads this set too, so an accidental
 * import from the runtime fails the same way an import of `src/server` would.
 */
const SERVER_ONLY_MODULES: ReadonlySet<string> = new Set([
  // The Nuxt module: Nuxt runs it in its build process, and it resolves the
  // shipped Nitro plugin's path from its own module URL.
  'src/adapters/nuxt/module.ts',
  // The two server files it writes, and the reading of a hook reference from disk.
  'src/adapters/nuxt/module-sources.ts',
]);
const NODE_BUILTINS = new Set(
  builtinModules.flatMap((module) => [
    module,
    module.startsWith('node:') ? module : `node:${module}`,
  ]),
);

/**
 * What a zone may never import at run time. The tree is the first layer rule:
 * nothing that may reach a browser imports an adapter, a server helper or a
 * tool, and no adapter imports a tool. A domain needs no entry for that, so a
 * new one under `src/runtime` is held to it before it has a list.
 */
const FORBIDDEN_ZONES: Readonly<Record<string, ReadonlySet<string>>> = {
  adapters: new Set(['tools']),
  runtime: new Set(['adapters', 'server', 'tools']),
};

/**
 * These rules protect the low-level runtime/security layers from convenient
 * upward imports while allowing type-only references, which are erased and
 * cannot create runtime coupling or cycles.
 *
 * Three entries exist because a domain without one may import anything:
 * `fragment` orchestrates above `core` (ADR 0011), so `core` may not reach it
 * and it may not pull an adapter or the client in; `types` is the leaf every
 * bundle shares, so a runtime import there would be paid by all of them; and
 * `adapters` take only the runtime seam, never the client or a tool.
 *
 * A list of a domain under `src/runtime` names runtime domains only: what
 * crosses a zone is in `FORBIDDEN_ZONES`.
 */
const FORBIDDEN_RUNTIME_DOMAINS: Readonly<Record<string, ReadonlySet<string>>> = {
  adapters: new Set(['client', 'payload']),
  client: new Set(['inline']),
  codegen: new Set([
    'adapters',
    'client',
    'core',
    'detection',
    'dsl',
    'events',
    'field-types',
    'inline',
    'lexical',
    'payload',
    'plugins',
    'schema',
    'security',
  ]),
  core: new Set(['client', 'fragment', 'inline', 'plugins']),
  detection: new Set(['client', 'core', 'field-types', 'inline', 'lexical', 'plugins', 'schema']),
  dsl: new Set([
    'client',
    'core',
    'detection',
    'events',
    'field-types',
    'inline',
    'lexical',
    'plugins',
    'schema',
    'security',
  ]),
  events: new Set(['client', 'field-types', 'inline', 'lexical', 'plugins', 'schema', 'security']),
  'field-types': new Set(['client', 'inline', 'plugins']),
  fragment: new Set(['client', 'inline', 'plugins']),
  inline: new Set([
    'client',
    'core',
    'detection',
    'dsl',
    'events',
    'field-types',
    'lexical',
    'plugins',
    'schema',
    'security',
  ]),
  lexical: new Set([
    'client',
    'core',
    'detection',
    'events',
    'field-types',
    'inline',
    'plugins',
    'schema',
  ]),
  payload: new Set([
    'adapters',
    'client',
    'codegen',
    'core',
    'detection',
    'dsl',
    'events',
    'field-types',
    'inline',
    'lexical',
    'plugins',
    'schema',
    'security',
  ]),
  plugins: new Set(['client', 'inline']),
  schema: new Set(['client', 'field-types', 'inline', 'lexical', 'plugins']),
  security: new Set([
    'client',
    'core',
    'detection',
    'dsl',
    'events',
    'field-types',
    'inline',
    'lexical',
    'plugins',
    'schema',
  ]),
  types: new Set([
    'client',
    'core',
    'detection',
    'dsl',
    'events',
    'field-types',
    'fragment',
    'inline',
    'lexical',
    'plugins',
    'schema',
    'security',
  ]),
};

/** The zone of a module: its folder under `src/`, or `<entry>` for a file beside the zones. */
function zoneFor(path: string): string {
  const parts = path.split('/');
  if (parts[0] !== 'src') return parts[0] ?? path;
  return parts.length === 2 ? '<entry>' : (parts[1] ?? '<entry>');
}

/**
 * The domain of a module, which the deny-lists above are written in.
 * `adapters` is one domain; in the other zones a domain is a folder, and a
 * file beside the folders belongs to the zone (`src/server/index.ts` is
 * `server`, `src/server/payload/` is `payload`).
 */
function domainFor(path: string): string {
  const zone = zoneFor(path);
  const parts = path.split('/');
  if (parts[0] !== 'src' || zone === 'adapters' || parts.length <= 3) return zone;
  return parts[2] ?? zone;
}

function isNodeBuiltin(specifier: string): boolean {
  return NODE_BUILTINS.has(specifier);
}

/** True for code that only ever runs on a server or in a build, never in a page. */
function isServerOnly(path: string): boolean {
  return SERVER_ONLY_ZONES.has(zoneFor(path)) || SERVER_ONLY_MODULES.has(path);
}

function findRuntimeCycles(
  modules: readonly ArchitectureModule[],
): readonly ArchitectureViolation[] {
  const adjacency = new Map(
    modules.map((module) => [
      module.path,
      module.dependencies
        .filter(
          (dependency): dependency is ArchitectureDependency & { readonly target: string } =>
            dependency.kind === 'runtime' && dependency.target !== undefined,
        )
        .map(({ target }) => target),
    ]),
  );
  const indexByModule = new Map<string, number>();
  const lowLinkByModule = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const violations: ArchitectureViolation[] = [];
  let nextIndex = 0;

  const visit = (module: string): void => {
    indexByModule.set(module, nextIndex);
    lowLinkByModule.set(module, nextIndex);
    nextIndex += 1;
    stack.push(module);
    onStack.add(module);

    for (const dependency of adjacency.get(module) ?? []) {
      if (!indexByModule.has(dependency)) {
        visit(dependency);
        lowLinkByModule.set(
          module,
          Math.min(lowLinkByModule.get(module)!, lowLinkByModule.get(dependency)!),
        );
      } else if (onStack.has(dependency)) {
        lowLinkByModule.set(
          module,
          Math.min(lowLinkByModule.get(module)!, indexByModule.get(dependency)!),
        );
      }
    }

    if (lowLinkByModule.get(module) !== indexByModule.get(module)) return;
    const component: string[] = [];
    let member: string;
    do {
      member = stack.pop()!;
      onStack.delete(member);
      component.push(member);
    } while (member !== module);

    const sorted = component.sort();
    const selfCycle = sorted.length === 1 && (adjacency.get(sorted[0]!) ?? []).includes(sorted[0]!);
    if (sorted.length > 1 || selfCycle) {
      violations.push({
        kind: 'runtime-cycle',
        module: sorted[0]!,
        message: `runtime import cycle: ${sorted.join(' -> ')}`,
      });
    }
  };

  for (const module of [...adjacency.keys()].sort()) {
    if (!indexByModule.has(module)) visit(module);
  }
  return violations;
}

export function findArchitectureViolations(
  modules: readonly ArchitectureModule[],
): readonly ArchitectureViolation[] {
  const violations: ArchitectureViolation[] = [];

  for (const module of modules) {
    const sourceDomain = domainFor(module.path);
    const sourceIsServerOnly = isServerOnly(module.path);
    for (const dependency of module.dependencies) {
      if (dependency.target === undefined && isInternalSourceSpecifier(dependency.specifier)) {
        violations.push({
          kind: 'unresolved-internal',
          module: module.path,
          dependency: dependency.specifier,
          message: `${module.path} has unresolved internal import ${dependency.specifier}`,
        });
      }
      if (dependency.kind === 'type') continue;

      if (isNodeBuiltin(dependency.specifier) && !sourceIsServerOnly) {
        violations.push({
          kind: 'browser-node-builtin',
          module: module.path,
          dependency: dependency.specifier,
          message: `${module.path} imports Node builtin ${dependency.specifier} outside a server-only entry`,
        });
      }

      if (dependency.target === undefined) continue;
      const targetDomain = domainFor(dependency.target);
      if (!sourceIsServerOnly && isServerOnly(dependency.target)) {
        violations.push({
          kind: 'server-boundary',
          module: module.path,
          dependency: dependency.target,
          message: `${module.path} imports server-only ${dependency.target}`,
        });
      }
      if (
        FORBIDDEN_ZONES[zoneFor(module.path)]?.has(zoneFor(dependency.target)) === true ||
        FORBIDDEN_RUNTIME_DOMAINS[sourceDomain]?.has(targetDomain) === true
      ) {
        violations.push({
          kind: 'layer-boundary',
          module: module.path,
          dependency: dependency.target,
          message: `${module.path} crosses the ${sourceDomain} -> ${targetDomain} runtime boundary`,
        });
      }
    }
  }

  violations.push(...findRuntimeCycles(modules));
  return violations.sort((left, right) => left.message.localeCompare(right.message));
}

/**
 * Attribute writes are held site by site — most set `role` or `aria-*` to a
 * constant — so outside the core they are the sink inventory's business, not
 * a module-level capability to review.
 */
const SITE_LEVEL_KINDS: ReadonlySet<CapabilityKind> = new Set(['attribute-sink']);

/**
 * Every module holds exactly the capabilities the reviewed policy says it
 * holds. A core module's list is exact in both directions; a module outside
 * the core must be reviewed for each capability it holds, may never hold a
 * core-only one, and a review that names a capability the module no longer
 * holds is stale. So a `fetch` that appears in a renderer fails here, and so
 * does one that quietly leaves the module its review was written for.
 */
export function findCapabilityViolations(
  modules: readonly ArchitectureModule[],
  policy: TrustedCorePolicy,
): readonly ArchitectureViolation[] {
  const violations: ArchitectureViolation[] = [];
  const report = (module: string, message: string): void => {
    violations.push({ kind: 'capability', module, message });
  };
  const coreOnly = new Set(policy.coreOnly);

  for (const module of modules) {
    const held = new Set(module.capabilities.map(({ kind }) => kind));
    const core = policy.core.modules[module.path];
    if (core !== undefined) {
      for (const kind of held) {
        if (!core.includes(kind)) {
          report(
            module.path,
            `${module.path} holds ${kind}, which ${TRUSTED_CORE_POLICY_FILE} does not list for it`,
          );
        }
      }
      for (const kind of core) {
        if (!held.has(kind)) {
          report(
            module.path,
            `${module.path} no longer holds ${kind}; remove it from ${TRUSTED_CORE_POLICY_FILE}`,
          );
        }
      }
      continue;
    }
    const reviewed = policy.outsideCore[module.path];
    for (const kind of held) {
      if (SITE_LEVEL_KINDS.has(kind)) continue;
      if (coreOnly.has(kind)) {
        report(module.path, `${module.path} holds ${kind}, which only the trusted core may hold`);
      } else if (reviewed?.capabilities.includes(kind) !== true) {
        report(
          module.path,
          `${module.path} holds ${kind} and is neither in the trusted core nor reviewed for it in ${TRUSTED_CORE_POLICY_FILE}`,
        );
      }
    }
    if (reviewed === undefined) continue;
    for (const kind of reviewed.capabilities) {
      if (!held.has(kind)) {
        report(
          module.path,
          `${module.path} no longer holds ${kind}; its review in ${TRUSTED_CORE_POLICY_FILE} is stale`,
        );
      }
    }
  }

  const present = new Set(modules.map(({ path }) => path));
  for (const path of [...Object.keys(policy.core.modules), ...Object.keys(policy.outsideCore)]) {
    if (!present.has(path)) {
      report(path, `${TRUSTED_CORE_POLICY_FILE} names ${path}, which does not exist`);
    }
  }
  return violations.sort((left, right) => left.message.localeCompare(right.message));
}
