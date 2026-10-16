import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import livePreviewModule, {
  type NitroConfigLike,
  type NuxtLike,
  type NuxtTemplateLike,
} from '@adapters/nuxt/module';

/**
 * `nuxt dev` imports the generated plugin without bundling it, and nothing in
 * that import adds an extension to a bare path; the production build does, which
 * is why the extensionless reference the guide shows built and ran there and
 * answered 500 in development. The module names the file it found, with its
 * extension, wherever it can read one.
 */

const ADMIN = 'https://admin.example.com';
let root = '';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'plp-nuxt-reference-'));
  mkdirSync(join(root, 'server/utils'), { recursive: true });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function generated(
  reference: string,
  alias?: Record<string, string>,
): { plugin: string; handler: string } {
  const templates: NuxtTemplateLike[] = [];
  const nitro: NitroConfigLike = {};
  let run: ((config: NitroConfigLike) => void) | undefined;
  const nuxt: NuxtLike = {
    options: {
      rootDir: root,
      buildDir: join(root, '.nuxt'),
      build: { templates },
      ...(alias !== undefined && { alias }),
    },
    hook: (_name, handler) => {
      run = handler;
    },
  };
  livePreviewModule({ allowedOrigins: [ADMIN], authorizePreviewModule: reference }, nuxt);
  run?.(nitro);
  const [plugin, handler] = templates;
  return { plugin: plugin?.getContents() ?? '', handler: handler?.getContents() ?? '' };
}

const imported = (source: string): string =>
  /import authorizePreview from "([^"]*)";/u.exec(source)?.[1] ?? '';

describe('a project-relative authorizePreviewModule is named with its extension', () => {
  it.each([
    ['.ts', 'live-preview-auth.ts'],
    ['.mts', 'live-preview-auth.mts'],
    ['.js', 'live-preview-auth.js'],
    ['.mjs', 'live-preview-auth.mjs'],
  ])('finds the %s file the reference names', (_extension, file) => {
    writeFileSync(join(root, 'server/utils', file), 'export default () => null;\n');
    const { plugin, handler } = generated('./server/utils/live-preview-auth');
    expect(imported(plugin)).toBe(join(root, 'server/utils', file));
    // The server handler is the same hook: the two generated files agree.
    expect(imported(handler)).toBe(join(root, 'server/utils', file));
  });

  it('prefers TypeScript to JavaScript when both exist, as the bundler does', () => {
    writeFileSync(join(root, 'server/utils/live-preview-auth.js'), 'export default () => null;\n');
    writeFileSync(join(root, 'server/utils/live-preview-auth.ts'), 'export default () => null;\n');
    expect(imported(generated('./server/utils/live-preview-auth').plugin)).toBe(
      join(root, 'server/utils/live-preview-auth.ts'),
    );
  });

  it('finds the index of a directory', () => {
    mkdirSync(join(root, 'server/utils/auth'));
    writeFileSync(join(root, 'server/utils/auth/index.ts'), 'export default () => null;\n');
    expect(imported(generated('./server/utils/auth').plugin)).toBe(
      join(root, 'server/utils/auth/index.ts'),
    );
  });

  it('keeps an extension the reference already carries, also when the name has dots', () => {
    writeFileSync(join(root, 'server/utils/live-preview-auth.ts'), 'export default () => null;\n');
    writeFileSync(join(root, 'server/utils/auth.server.ts'), 'export default () => null;\n');
    expect(imported(generated('./server/utils/live-preview-auth.ts').plugin)).toBe(
      join(root, 'server/utils/live-preview-auth.ts'),
    );
    expect(imported(generated('./server/utils/auth.server').plugin)).toBe(
      join(root, 'server/utils/auth.server.ts'),
    );
  });

  it('leaves a reference to a file it cannot read as it was, for the bundler to report', () => {
    expect(imported(generated('./server/utils/missing').plugin)).toBe(
      join(root, 'server/utils/missing'),
    );
  });

  it('resolves an alias through the alias table Nuxt supplies', () => {
    writeFileSync(join(root, 'server/utils/live-preview-auth.ts'), 'export default () => null;\n');
    const alias = { '~': root, '~~': root, '@': root };
    expect(imported(generated('~/server/utils/live-preview-auth', alias).plugin)).toBe(
      join(root, 'server/utils/live-preview-auth.ts'),
    );
    expect(imported(generated('~~/server/utils/live-preview-auth', alias).plugin)).toBe(
      join(root, 'server/utils/live-preview-auth.ts'),
    );
  });

  it('passes an alias it does not know, a package specifier and a missing target on unchanged', () => {
    writeFileSync(join(root, 'server/utils/live-preview-auth.ts'), 'export default () => null;\n');
    expect(imported(generated('#custom/auth', { '~': root }).plugin)).toBe('#custom/auth');
    expect(imported(generated('my-preview-auth/hook').plugin)).toBe('my-preview-auth/hook');
    expect(imported(generated('~/server/utils/none', { '~': root }).plugin)).toBe(
      '~/server/utils/none',
    );
    expect(imported(generated('~/server/utils/live-preview-auth').plugin)).toBe(
      '~/server/utils/live-preview-auth',
    );
  });
});
