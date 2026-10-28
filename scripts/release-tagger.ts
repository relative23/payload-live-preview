/**
 * Who writes the release tag. Changesets tags with `-m`, so git writes an
 * annotated tag, and an annotated tag needs an identity the release checkout
 * does not configure — 2.0.0-rc.1 was published and left untagged that way.
 */

/** The identity the release tag is written under when the checkout carries none. */
const RELEASE_TAGGER = {
  name: 'github-actions[bot]',
  email: '41898282+github-actions[bot]@users.noreply.github.com',
} as const;

/**
 * Changesets tags with `-m`, so git writes an annotated tag, and an annotated
 * tag needs an identity. The release checkout configures none — and Changesets
 * ignores what `git tag` answers, so a refusal reaches the log as "New tag" and
 * nothing else. 2.0.0-rc.1 was published and left untagged that way. An
 * identity is supplied here when neither the environment nor the repository
 * has one; a configured identity is never overridden.
 */
export function releaseTaggerEnvironment(
  environment: NodeJS.ProcessEnv,
  repositoryIdentity: boolean,
): NodeJS.ProcessEnv {
  const named = environment['GIT_COMMITTER_NAME'] !== undefined;
  const mailed = environment['GIT_COMMITTER_EMAIL'] !== undefined;
  if (repositoryIdentity || (named && mailed)) return environment;
  return {
    ...environment,
    GIT_AUTHOR_NAME: environment['GIT_AUTHOR_NAME'] ?? RELEASE_TAGGER.name,
    GIT_AUTHOR_EMAIL: environment['GIT_AUTHOR_EMAIL'] ?? RELEASE_TAGGER.email,
    GIT_COMMITTER_NAME: environment['GIT_COMMITTER_NAME'] ?? RELEASE_TAGGER.name,
    GIT_COMMITTER_EMAIL: environment['GIT_COMMITTER_EMAIL'] ?? RELEASE_TAGGER.email,
  };
}

/** What `repositoryHasIdentity` needs of a command runner: the status and what it printed. */
export type IdentityProbe = (
  executable: string,
  args: readonly string[],
) => { readonly status: number; readonly stdout: string };

/** Whether this repository can write an annotated tag on its own. */
export function repositoryHasIdentity(probe: IdentityProbe): boolean {
  const name = probe('git', ['config', '--get', 'user.name']);
  const email = probe('git', ['config', '--get', 'user.email']);
  return (
    name.status === 0 &&
    name.stdout.trim() !== '' &&
    email.status === 0 &&
    email.stdout.trim() !== ''
  );
}
