import { describe, expect, it } from 'vitest';
import {
  createPackageArtifactManifest,
  findPackageArtifactManifestViolations,
  parseNpmPackReport,
  parsePackageArtifactArguments,
  isSafePackageArchiveFilename,
  type PackageArchiveEvidence,
} from '../../scripts/package-artifact';
import { buildGeneratedAt } from '../../scripts/source-date-epoch';

const EVIDENCE: PackageArchiveEvidence = {
  filename: 'payload-live-preview-1.0.4.tgz',
  name: 'payload-live-preview',
  version: '1.0.4',
  size: 1234,
  unpackedSize: 4321,
  sha1: '1'.repeat(40),
  sha256: '2'.repeat(64),
  integrity: `sha512-${Buffer.alloc(64, 3).toString('base64')}`,
  files: [
    { path: 'LICENSE', size: 1088, mode: 0o755 },
    { path: 'dist/index.js', size: 2048, mode: 0o644 },
    { path: 'package.json', size: 4096, mode: 0o644 },
  ],
};

const SOURCE_COMMIT = 'a'.repeat(40);
const SOURCE_DATE_EPOCH = '1786579200';
interface MutableManifest {
  source: { commit: string };
  package: { version: string };
  archive: { sha256: string };
  toolchain: { node: string };
  files: unknown[];
}

describe('package artifact manifest', () => {
  it('binds the exact archive, complete sorted inventory, source, and toolchain', () => {
    const manifest = createPackageArtifactManifest({
      evidence: EVIDENCE,
      sourceCommit: SOURCE_COMMIT,
      sourceDateEpoch: SOURCE_DATE_EPOCH,
      nodeVersion: 'v22.18.0',
      npmVersion: '11.16.0',
    });

    expect(
      findPackageArtifactManifestViolations(manifest, {
        evidence: EVIDENCE,
        expectedName: 'payload-live-preview',
        expectedVersion: '1.0.4',
        expectedSourceCommit: SOURCE_COMMIT,
        expectedSourceDateEpoch: SOURCE_DATE_EPOCH,
        expectedNodeVersion: 'v22.18.0',
        expectedNpmVersion: '11.16.0',
      }),
    ).toEqual([]);
    expect(manifest.files.map(({ path }) => path)).toEqual([
      'LICENSE',
      'dist/index.js',
      'package.json',
    ]);
  });

  it.each([
    ['commit', (manifest: MutableManifest) => (manifest.source.commit = 'b'.repeat(40))],
    ['version', (manifest: MutableManifest) => (manifest.package.version = '1.0.3')],
    ['digest', (manifest: MutableManifest) => (manifest.archive.sha256 = 'f'.repeat(64))],
    ['toolchain', (manifest: MutableManifest) => (manifest.toolchain.node = 'v22.99.0')],
    ['inventory', (manifest: MutableManifest) => manifest.files.pop()],
  ])('rejects artifact manifest drift in %s', (_label, mutate) => {
    const manifest = structuredClone(
      createPackageArtifactManifest({
        evidence: EVIDENCE,
        sourceCommit: SOURCE_COMMIT,
        sourceDateEpoch: SOURCE_DATE_EPOCH,
        nodeVersion: 'v22.18.0',
        npmVersion: '11.16.0',
      }),
    ) as unknown as MutableManifest;
    mutate(manifest);

    expect(
      findPackageArtifactManifestViolations(manifest, {
        evidence: EVIDENCE,
        expectedName: 'payload-live-preview',
        expectedVersion: '1.0.4',
        expectedSourceCommit: SOURCE_COMMIT,
        expectedSourceDateEpoch: SOURCE_DATE_EPOCH,
        expectedNodeVersion: 'v22.18.0',
        expectedNpmVersion: '11.16.0',
      }),
    ).not.toEqual([]);
  });

  it('parses persistent-pack and exact-tarball modes without accepting a repack ambiguity', () => {
    expect(parsePackageArtifactArguments(['--artifact-dir', 'release-artifact'])).toMatchObject({
      artifactDirectory: 'release-artifact',
      tarball: undefined,
    });
    expect(
      parsePackageArtifactArguments(['--tarball', 'release-artifact/package.tgz']),
    ).toMatchObject({
      artifactDirectory: undefined,
      tarball: 'release-artifact/package.tgz',
      manifest: 'release-artifact/package-artifact.json',
    });
    expect(() =>
      parsePackageArtifactArguments([
        '--artifact-dir',
        'release-artifact',
        '--tarball',
        'release-artifact/package.tgz',
      ]),
    ).toThrow(/mutually exclusive/u);
  });

  it.each(['../outside', '/absolute', 'dist\\index.js', 'dist//index.js'])(
    'rejects unsafe npm inventory path %j',
    (path) => {
      expect(() =>
        parseNpmPackReport(
          JSON.stringify([
            {
              filename: EVIDENCE.filename,
              name: EVIDENCE.name,
              version: EVIDENCE.version,
              size: EVIDENCE.size,
              unpackedSize: EVIDENCE.unpackedSize,
              shasum: EVIDENCE.sha1,
              integrity: EVIDENCE.integrity,
              files: [{ path, size: 1, mode: 0o644 }],
            },
          ]),
        ),
      ).toThrow(/unsafe path/u);
    },
  );

  // npm 11 and earlier report an array of packages; npm 12 reports an object
  // keyed by package name. Same entries, so the parser takes either.
  it.each([
    ['npm 11 array', false],
    ['npm 12 object', true],
  ])('reads the pack report from %s', (_label, keyed) => {
    const entry = {
      filename: EVIDENCE.filename,
      name: EVIDENCE.name,
      version: EVIDENCE.version,
      size: EVIDENCE.size,
      unpackedSize: EVIDENCE.unpackedSize,
      shasum: EVIDENCE.sha1,
      integrity: EVIDENCE.integrity,
      files: [{ path: 'package.json', size: 1, mode: 0o644 }],
    };
    const report = parseNpmPackReport(JSON.stringify(keyed ? { [EVIDENCE.name]: entry } : [entry]));
    expect(report.filename).toBe(EVIDENCE.filename);
    expect(report.version).toBe(EVIDENCE.version);
    expect(report.files.map((file) => file.path)).toEqual(['package.json']);
  });

  it('refuses a report carrying more than one package, in either shape', () => {
    const entry = {
      filename: EVIDENCE.filename,
      name: EVIDENCE.name,
      version: EVIDENCE.version,
      size: EVIDENCE.size,
      unpackedSize: EVIDENCE.unpackedSize,
      shasum: EVIDENCE.sha1,
      integrity: EVIDENCE.integrity,
      files: [{ path: 'package.json', size: 1, mode: 0o644 }],
    };
    expect(() => parseNpmPackReport(JSON.stringify({ a: entry, b: entry }))).toThrow(
      /unexpected JSON report/u,
    );
    expect(() => parseNpmPackReport(JSON.stringify([entry, entry]))).toThrow(
      /unexpected JSON report/u,
    );
  });

  it('rejects duplicate inventory entries before an archive can be certified', () => {
    expect(() =>
      parseNpmPackReport(
        JSON.stringify([
          {
            filename: EVIDENCE.filename,
            name: EVIDENCE.name,
            version: EVIDENCE.version,
            size: EVIDENCE.size,
            unpackedSize: EVIDENCE.unpackedSize,
            shasum: EVIDENCE.sha1,
            integrity: EVIDENCE.integrity,
            files: [
              { path: 'package.json', size: 1, mode: 0o644 },
              { path: 'package.json', size: 2, mode: 0o644 },
            ],
          },
        ]),
      ),
    ).toThrow(/repeats path/u);
  });

  it.each([
    '.',
    '..',
    '../package.tgz',
    'package.tar.gz',
    'nested/package.tgz',
    'nested\\package.tgz',
  ])('rejects unsafe package archive filename %j', (filename) => {
    expect(isSafePackageArchiveFilename(filename)).toBe(false);
  });

  it('accepts one basename-only npm tgz filename', () => {
    expect(isSafePackageArchiveFilename('payload-live-preview-1.0.4.tgz')).toBe(true);
  });
});

describe('reproducible runtime build timestamp', () => {
  it('uses SOURCE_DATE_EPOCH exactly and keeps a local wall-clock fallback', () => {
    expect(buildGeneratedAt({ SOURCE_DATE_EPOCH: '0' }, () => new Date('2030-01-01'))).toBe(
      '1970-01-01T00:00:00.000Z',
    );
    expect(buildGeneratedAt({}, () => new Date('2030-01-01T12:34:56.789Z'))).toBe(
      '2030-01-01T12:34:56.789Z',
    );
  });

  it.each(['', '-1', '1.5', 'not-a-date', '999999999999999999999'])(
    'rejects malformed SOURCE_DATE_EPOCH %j',
    (value) => {
      expect(() => buildGeneratedAt({ SOURCE_DATE_EPOCH: value })).toThrow(/SOURCE_DATE_EPOCH/u);
    },
  );
});
