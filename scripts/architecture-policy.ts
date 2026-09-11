/**
 * Executable entry for the source-layer, server/browser and cycle policy. The
 * graph is rebuilt from source each run so the gate cannot pass on a snapshot.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readArchitectureModules } from './architecture-graph';
import { findArchitectureViolations, findCapabilityViolations } from './architecture-rules';
import { findSinkViolations, SINK_INVENTORY } from './sink-rules';
import { readTrustedCorePolicy } from './trusted-core-policy';

async function main(): Promise<void> {
  const repositoryRoot = resolve(import.meta.dirname, '..');
  const modules = await readArchitectureModules(repositoryRoot);
  const policy = await readTrustedCorePolicy(repositoryRoot);
  const violations = [
    ...findArchitectureViolations(modules),
    ...findCapabilityViolations(modules, policy),
    ...findSinkViolations(modules, SINK_INVENTORY, (path) =>
      readFileSync(resolve(repositoryRoot, path), 'utf8'),
    ),
  ];
  if (violations.length > 0) {
    throw new Error(
      `architecture policy failed:\n${violations.map(({ message }) => `- ${message}`).join('\n')}`,
    );
  }
  const runtimeEdges = modules.reduce(
    (count, module) =>
      count + module.dependencies.filter(({ kind, target }) => kind === 'runtime' && target).length,
    0,
  );
  const capabilityHolders = modules.filter(({ capabilities }) => capabilities.length > 0).length;
  console.log(
    `Architecture policy passed: ${String(modules.length)} modules, ${String(runtimeEdges)} runtime edges, ` +
      `no layer violations or cycles; ${String(capabilityHolders)} modules hold a capability, every one reviewed; ` +
      `${String(SINK_INVENTORY.html.size)} HTML and ${String(SINK_INVENTORY.attribute.size)} attribute sinks justified.`,
  );
}

const invokedPath = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (invokedPath !== undefined && fileURLToPath(import.meta.url) === invokedPath) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
