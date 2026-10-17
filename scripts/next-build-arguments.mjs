/**
 * The bundler of the Next production fixture's build. Next 16 builds with Turbopack unless told
 * `--webpack`; Next 15 builds with webpack and does not know that flag (measured on 15.5.28), so a
 * build a Playwright config asked to be webpack passes none there.
 */

/**
 * The bundler the build ends up with: the one asked for, else the default of the installed major.
 * @param {string | undefined} requested
 * @param {number} nextMajor
 * @returns {string}
 */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- Node must run this plain-JS fixture on Node 20 without a TS loader
export function effectiveBundler(requested, nextMajor) {
  return requested ?? (nextMajor < 16 ? 'webpack' : 'turbopack');
}

/**
 * The arguments `npm` gets to build the fixture.
 * @param {string | undefined} requested
 * @param {number} nextMajor
 * @returns {string[]}
 */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- Node must run this plain-JS fixture on Node 20 without a TS loader
export function nextBuildArguments(requested, nextMajor) {
  const flag = requested === 'webpack' && nextMajor < 16 ? undefined : requested;
  return flag === undefined ? ['run', 'build'] : ['run', 'build', '--', `--${flag}`];
}
