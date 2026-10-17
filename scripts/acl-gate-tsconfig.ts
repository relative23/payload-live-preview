/**
 * The tsx configuration of the real-Payload ACL gate. The gate asks an isolated consumer where
 * `payload-live-preview/server` lives and refuses an answer outside it, but tsx applies the repository
 * tsconfig's `paths` to every resolution in its process, so the entries that map the package's own names
 * to `src/` (the type-check's) made the gate answer with the workspace. This derives the configuration the
 * gate hands to tsx: the repository's aliases without the entries that name the package.
 */
import { parseConfigFileTextToJson } from 'typescript';

const PACKAGE_NAME = 'payload-live-preview';

export interface GateTsconfig {
  readonly extends: string;
  readonly compilerOptions: {
    readonly baseUrl: string;
    readonly paths: Readonly<Record<string, readonly string[]>>;
  };
}

export function deriveGateTsconfig(rootConfigText: string, repository: string): GateTsconfig {
  const parsed: { config?: unknown; error?: unknown } = parseConfigFileTextToJson(
    'tsconfig.json',
    rootConfigText,
  );
  if (parsed.error !== undefined || typeof parsed.config !== 'object' || parsed.config === null) {
    throw new Error('The ACL gate cannot read the repository tsconfig.json.');
  }
  const compilerOptions = (parsed.config as { compilerOptions?: { paths?: unknown } })
    .compilerOptions;
  const paths = compilerOptions?.paths;
  if (typeof paths !== 'object' || paths === null || Array.isArray(paths)) {
    throw new Error('The repository tsconfig.json has no compilerOptions.paths for the ACL gate.');
  }
  const kept: Record<string, readonly string[]> = {};
  for (const [alias, targets] of Object.entries(paths)) {
    if (alias === PACKAGE_NAME || alias.startsWith(`${PACKAGE_NAME}/`)) continue;
    kept[alias] = targets as readonly string[];
  }
  return {
    extends: `${repository}/tsconfig.json`,
    compilerOptions: { baseUrl: repository, paths: kept },
  };
}
