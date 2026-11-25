/**
 * Native resource contracts use exact, independently locked Astro consumers.
 * One version is reviewed today; an unknown selection is rejected before
 * an environment variable can choose dependency or artifact paths.
 */
export function astroResourceVersion(
  version = '7.4.5',
  renderer?: string,
): {
  version: string;
  dependencyRoot: string;
  artifactRoot: string;
} {
  if (
    renderer === 'react-server' ||
    renderer === 'react-unconfigured' ||
    renderer === 'react-islands' ||
    renderer === 'react-owned'
  ) {
    if (version !== '7.4.5') throw new Error('Unreviewed Astro React version: ' + version);
    return {
      version,
      dependencyRoot: 'tests/fixtures/astro-react-deps',
      artifactRoot:
        renderer === 'react-owned'
          ? 'test-results/hardening/h05-astro-owner/native'
          : renderer === 'react-islands'
            ? 'test-results/hardening/h05-astro-islands/native'
            : 'test-results/hardening/h05-astro-react/native',
    };
  }
  if (version !== '7.4.5') throw new Error('Unreviewed Astro resource version: ' + version);
  return {
    version,
    dependencyRoot: 'tests/fixtures/astro-resource-deps',
    artifactRoot: 'test-results/hardening/h05-astro-resources',
  };
}

export function astroResourceRenderer(
  version: string,
  requested?: string,
):
  | 'package-default'
  | 'verified-context'
  | 'locals-catalog'
  | 'react-server'
  | 'react-unconfigured'
  | 'react-islands'
  | 'react-owned' {
  if (
    requested === 'react-server' ||
    requested === 'react-unconfigured' ||
    requested === 'react-islands' ||
    requested === 'react-owned'
  ) {
    astroResourceVersion(version, requested);
    return requested;
  }
  astroResourceVersion(version);
  if (requested === undefined) return 'verified-context';
  if (requested === 'locals-catalog' || requested === 'package-default') return requested;
  throw new Error('Unreviewed Astro resource renderer: ' + requested);
}
