/**
 * The Next production fixture builds with the bundler a Playwright config asks for. Next 16 builds with
 * Turbopack unless told `--webpack`; Next 15 builds with webpack and does not know that flag, so a build
 * the config asked to be webpack must not pass it there. Measured on Next 15.5.25 on 2026-10-17.
 */
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const moduleUrl = pathToFileURL(resolve('scripts/next-build-arguments.mjs')).href;
const { effectiveBundler, nextBuildArguments } = (await import(moduleUrl)) as {
  effectiveBundler: (requested: string | undefined, nextMajor: number) => string;
  nextBuildArguments: (requested: string | undefined, nextMajor: number) => string[];
};

describe('the arguments of the Next production build', () => {
  it('asks Next 16 for webpack by flag', () => {
    expect(nextBuildArguments('webpack', 16)).toEqual(['run', 'build', '--', '--webpack']);
  });

  it('does not pass Next 15 a flag it does not know, because its default build is webpack', () => {
    expect(nextBuildArguments('webpack', 15)).toEqual(['run', 'build']);
  });

  it('passes a Turbopack request through on both', () => {
    expect(nextBuildArguments('turbopack', 16)).toEqual(['run', 'build', '--', '--turbopack']);
    expect(nextBuildArguments('turbopack', 15)).toEqual(['run', 'build', '--', '--turbopack']);
  });

  it('leaves the build alone when no bundler was asked for', () => {
    expect(nextBuildArguments(undefined, 16)).toEqual(['run', 'build']);
    expect(nextBuildArguments(undefined, 15)).toEqual(['run', 'build']);
  });
});

describe('the bundler a Next production build ends up with', () => {
  it('is the default of the installed major when none was asked for', () => {
    expect(effectiveBundler(undefined, 16)).toBe('turbopack');
    expect(effectiveBundler(undefined, 15)).toBe('webpack');
  });

  it('is the one that was asked for otherwise', () => {
    expect(effectiveBundler('webpack', 16)).toBe('webpack');
    expect(effectiveBundler('turbopack', 15)).toBe('turbopack');
  });
});
