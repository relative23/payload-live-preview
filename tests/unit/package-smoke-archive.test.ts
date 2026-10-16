/**
 * Manifest quarantine disables lifecycle execution while retaining peer resolution.
 * Recording the real install call keeps an inherited npm setting from turning
 * this inspection into an exception to the strict consumer contract.
 */
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as SmokeSupport from '../../scripts/package-smoke-support';

const inspection = vi.hoisted(() => ({
  initializeConsumer: vi.fn(),
  run: vi.fn(),
}));
vi.mock('../../scripts/package-smoke-consumer', () => ({
  initializeConsumer: inspection.initializeConsumer,
}));
vi.mock('../../scripts/package-smoke-support', async (importOriginal) => ({
  ...(await importOriginal<typeof SmokeSupport>()),
  run: inspection.run,
}));
import { inspectPackedManifest } from '../../scripts/package-smoke-archive';

let temporaryRoot: string;
let inspector: string;
let installedManifest: string;
const TARBALL = resolve('/tmp', 'payload-live-preview-contract.tgz');
const MANIFEST = { name: 'payload-live-preview', version: '2.1.0', scripts: { build: 'build' } };

describe('packed manifest quarantine', () => {
  beforeEach(() => {
    inspection.initializeConsumer.mockReset().mockResolvedValue(undefined);
    temporaryRoot = mkdtempSync(resolve(tmpdir(), 'plp-manifest-inspection-contract-'));
    inspector = resolve(temporaryRoot, 'manifest-inspector');
    const installedPackage = resolve(inspector, 'node_modules/payload-live-preview');
    mkdirSync(installedPackage, { recursive: true });
    installedManifest = resolve(installedPackage, 'package.json');
    writeFileSync(installedManifest, JSON.stringify(MANIFEST));
    inspection.run.mockReset().mockReturnValue({ status: 0, stdout: '', stderr: '' });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(temporaryRoot, { recursive: true, force: true });
  });

  it('resolves peers strictly while quarantine keeps lifecycle hooks disabled', async () => {
    vi.stubEnv('npm_config_legacy_peer_deps', 'true');
    expect(await inspectPackedManifest(temporaryRoot, TARBALL)).toEqual(MANIFEST);
    expect(inspection.initializeConsumer).toHaveBeenCalledExactlyOnceWith(inspector);
    expect(inspection.run).toHaveBeenCalledTimes(1);
    const invocation = inspection.run.mock.calls[0];
    expect(invocation?.[0]).toBe('npm');
    expect(invocation?.[2]).toBe(inspector);
    const args = invocation?.[1] as readonly string[];
    expect(args).toEqual(
      expect.arrayContaining(['install', '--ignore-scripts', '--legacy-peer-deps=false', TARBALL]),
    );
    expect(args).toContain('--offline');
    expect(args).toContain('--no-save');
    expect(args).not.toContain('--legacy-peer-deps');
    expect(args).not.toContain('--legacy-peer-deps=true');
    expect(args).not.toContain('--force');
    expect(args).not.toContain('--ignore-scripts=false');
  });

  it('waits for isolated consumer initialization before invoking npm', async () => {
    let initialized!: () => void;
    inspection.initializeConsumer.mockReturnValue(
      new Promise<void>((done) => {
        initialized = done;
      }),
    );
    const pending = inspectPackedManifest(temporaryRoot, TARBALL);
    await Promise.resolve();
    expect(inspection.run).not.toHaveBeenCalled();
    initialized();
    await expect(pending).resolves.toEqual(MANIFEST);
    expect(inspection.run).toHaveBeenCalledTimes(1);
  });

  it('stops on peer resolution failure without retrying or reading an installed manifest', async () => {
    unlinkSync(installedManifest);
    inspection.run.mockReturnValue({ status: 1, stdout: '', stderr: 'ERESOLVE peer conflict' });
    await expect(inspectPackedManifest(temporaryRoot, TARBALL)).rejects.toThrow(
      'ERESOLVE peer conflict',
    );
    expect(inspection.run).toHaveBeenCalledTimes(1);
  });

  it('rejects a quarantined manifest with a forbidden hook after the disabled-script install', async () => {
    writeFileSync(
      installedManifest,
      JSON.stringify({ ...MANIFEST, scripts: { postinstall: 'forbidden hook' } }),
    );
    await expect(inspectPackedManifest(temporaryRoot, TARBALL)).rejects.toThrow(
      'scripts.postinstall',
    );
    expect(inspection.run).toHaveBeenCalledTimes(1);
    expect(inspection.run.mock.calls[0]?.[1]).toContain('--ignore-scripts');
  });
});
