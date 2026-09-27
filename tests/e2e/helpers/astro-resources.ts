/**
 * Native Astro resource contracts require real template checks and computed styles.
 * Its negative control distinguishes semantic checking from transpilation;
 * the retained asset record contains public output hashes, never private state.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import type { Frame } from '@playwright/test';
import { probeUnavailableDependencies } from '../../../scripts/package-smoke-consumer';

export async function readAstroResourceStyles(frame: Frame) {
  return frame.getByTestId('resource-card').evaluateAll((elements) =>
    elements.map((element) => ({
      border: getComputedStyle(element).borderTopWidth,
      color: getComputedStyle(element).color,
      nested: getComputedStyle(element.querySelector('[data-testid="resource-badge"]')!)
        .letterSpacing,
      scoped: element.getAttributeNames().some((name) => name.startsWith('data-astro-cid-')),
    })),
  );
}

export async function checkAstroResourceTemplates(
  app: string,
  artifact: string,
  env: NodeJS.ProcessEnv,
  logs: string[],
  withReact = false,
  withIslands = false,
): Promise<void> {
  const probe = probeUnavailableDependencies(app, [
    ...(withReact ? [] : ['react', 'react-dom']),
    'vue',
    'svelte',
    'nuxt',
    'payload',
  ]);
  logs.push(
    `${withReact ? 'Astro+React' : 'Astro-only'} resolution probe\n${probe.stdout}\n${probe.stderr}`,
  );
  assert.equal(probe.status, 0, 'Astro app resolved an unrelated renderer or CMS peer');
  const bridge = await readFile(
    join(app, 'node_modules/payload-live-preview/dist/adapters/astro/FragmentBridge.astro'),
    'utf8',
  ).catch((error: unknown) => {
    if (
      typeof error !== 'object' ||
      error === null ||
      !('code' in error) ||
      error.code !== 'ENOENT'
    ) {
      throw error;
    }
    return undefined;
  });
  const bridgeControl = join(app, 'src/components/__package_bridge.astro');
  // Dependencies are outside the checker's normal project scan. Check the exact
  // installed template as a local copy, then remove the copy before production.
  if (bridge !== undefined) {
    await writeFile(bridgeControl, bridge);
    await copyFile(
      'tests/fixtures/astro-bridge-contract/endpoint.ts.fixture',
      join(app, 'src/pages/bridge-contract-check.ts'),
    );
    if (withReact) {
      // This independent bridge guard renders the catalog too. Its configured
      // container is not the endpoint whose missing renderer is countertested.
      const path = join(app, 'src/pages/bridge-contract-check.ts');
      const source = await readFile(path, 'utf8');
      const create = 'const container = await experimental_AstroContainer.create();';
      assert.equal(source.split(create).length, 2);
      await writeFile(
        path,
        "import reactRenderer from '@astrojs/react/server.js';\n" +
          source.replace(
            create,
            create +
              '\n  container.addServerRenderer({ renderer: reactRenderer });' +
              (withIslands
                ? "\n  container.addClientRenderer({ name: '@astrojs/react', entrypoint: '@astrojs/react/client.js' });"
                : ''),
          ),
      );
    }
  }
  const positive = spawnSync('npm', ['run', 'typecheck'], {
    cwd: app,
    env,
    encoding: 'utf8',
    timeout: 60_000,
  });
  logs.push(`npm run typecheck (real templates)\n${positive.stdout}\n${positive.stderr}`);
  assert.equal(positive.status, 0, 'Real Astro templates failed semantic checking');
  const control = join(app, 'src/components/__typecheck_counterexample.astro');
  await copyFile(join(app, 'type-contracts/Negative.astro'), control);
  const negative = spawnSync('npm', ['run', 'typecheck'], {
    cwd: app,
    env,
    encoding: 'utf8',
    timeout: 60_000,
  });
  logs.push(
    `npm run typecheck (negative Astro template control)\n${negative.stdout}\n${negative.stderr}`,
  );
  await unlink(control);
  assert.equal(negative.status, 1, 'Semantic Astro counterexample must fail');
  const diagnostic = stripVTControlCharacters(negative.stdout);
  assert.ok(diagnostic.includes('__typecheck_counterexample.astro'));
  assert.ok(diagnostic.includes("Property 'toFixed' does not exist on type 'string'"));
  assert.ok(diagnostic.includes('error ts(2551)'));
  assert.equal((diagnostic.match(/error ts\(/gu) ?? []).length, 1);
  await mkdir(artifact, { recursive: true });
  if (bridge !== undefined) {
    const expression = "Reflect.get(Astro.locals, '__payloadLivePreviewFragment')";
    assert.equal(bridge.split(expression).length, 2, 'Unknown installed bridge shape');
    await writeFile(bridgeControl, bridge.replace(expression, "String('bridge').toFixed()"));
    const invalid = spawnSync('npm', ['run', 'typecheck'], {
      cwd: app,
      env,
      encoding: 'utf8',
      timeout: 60_000,
    });
    logs.push(
      `npm run typecheck (installed bridge negative control)\n${invalid.stdout}\n${invalid.stderr}`,
    );
    await unlink(bridgeControl);
    assert.equal(invalid.status, 1, 'Installed bridge counterexample must fail');
    const diagnostic = stripVTControlCharacters(invalid.stdout);
    assert.ok(diagnostic.includes('__package_bridge.astro'));
    assert.ok(diagnostic.includes("Property 'toFixed' does not exist on type 'string'"));
    assert.equal((diagnostic.match(/error ts\(/gu) ?? []).length, 1);
    await writeFile(
      join(artifact, 'bridge-typecheck-control.json'),
      JSON.stringify(
        {
          sourceSHA256: createHash('sha256').update(bridge).digest('hex'),
          positiveExit: positive.status,
          negativeExit: invalid.status,
          error: 'TS2551',
          exactInstalledTemplate: true,
          removedBeforeProductionBuild: true,
        },
        null,
        2,
      ),
    );
  }
  await writeFile(
    join(artifact, 'typecheck-control.json'),
    JSON.stringify(
      {
        argv: ['npm', 'run', 'typecheck'],
        positiveExit: positive.status,
        negativeExit: negative.status,
        error: 'TS2551',
        counterexample: 'src/components/__typecheck_counterexample.astro',
        removedBeforeProductionBuild: true,
      },
      null,
      2,
    ),
  );
  if (withReact) {
    const control = join(app, 'src/components/__typecheck_counterexample.tsx');
    await copyFile(join(app, 'type-contracts/Negative.tsx'), control);
    const negative = spawnSync('npm', ['run', 'typecheck'], {
      cwd: app,
      env,
      encoding: 'utf8',
      timeout: 60_000,
    });
    logs.push(
      `npm run typecheck (React TSX negative control)\n${negative.stdout}\n${negative.stderr}`,
    );
    await unlink(control);
    assert.equal(negative.status, 1, 'React semantic counterexample must fail');
    const diagnostic = stripVTControlCharacters(negative.stdout);
    assert.ok(diagnostic.includes('__typecheck_counterexample.tsx'));
    assert.ok(diagnostic.includes("Property 'toFixed' does not exist on type 'string'"));
    assert.equal((diagnostic.match(/error ts\(/gu) ?? []).length, 1);
    await writeFile(
      join(artifact, 'react-typecheck-control.json'),
      JSON.stringify(
        {
          positiveExit: positive.status,
          negativeExit: negative.status,
          error: 'TS2551',
          counterexample: 'src/components/__typecheck_counterexample.tsx',
          removedBeforeProductionBuild: true,
        },
        null,
        2,
      ),
    );
  }
}

export async function checkAstroBridgeRuntime(artifact: string, port: string): Promise<void> {
  // Retained pre-fix archives have no bridge. New archive audits require both
  // control records, so absence cannot pass as verification of a fixed package.
  if (!(await readdir(artifact)).includes('bridge-typecheck-control.json')) return;
  const response = await fetch(`http://127.0.0.1:${port}/bridge-contract-check`);
  assert.equal(response.status, 200, 'Native bridge guard route failed');
  const result: unknown = await response.json();
  assert.deepEqual(result, {
    rejected: Array.from({ length: 8 }, () => true),
    rendered: true,
    escaped: true,
  });
  await writeFile(join(artifact, 'bridge-runtime-control.json'), JSON.stringify(result, null, 2));
}

export async function recordAstroResources(app: string, artifact: string): Promise<void> {
  const entries: { path: string; bytes: number; sha256: string }[] = [];
  const catalogStylesheets: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const file of await readdir(join(app, directory), { withFileTypes: true })) {
      const path = `${directory}/${file.name}`;
      if (file.isDirectory()) await visit(path);
      else {
        const bytes = await readFile(join(app, path));
        // Astro 4 names chunks after the route, newer builds after the component.
        // Identify this fixed catalog by both real rules, never by a chunk basename.
        if (
          path.endsWith('.css') &&
          /border-top:\s*7px solid/u.test(bytes.toString()) &&
          /letter-spacing:\s*3px/u.test(bytes.toString())
        ) {
          catalogStylesheets.push(path);
        }
        entries.push({
          path,
          bytes: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        });
      }
    }
  };
  await visit('dist');
  assert.equal(catalogStylesheets.length, 1, 'Missing or duplicated emitted catalog stylesheet');
  const bytes = await readFile(
    join(app, 'node_modules/payload-live-preview/dist/adapters/astro/index.js'),
  );
  await writeFile(
    join(artifact, 'build.json'),
    JSON.stringify(
      {
        astroEntrySHA256: createHash('sha256').update(bytes).digest('hex'),
        catalogStylesheets,
        artifacts: entries.sort((a, b) => a.path.localeCompare(b.path)),
      },
      null,
      2,
    ),
  );
}
