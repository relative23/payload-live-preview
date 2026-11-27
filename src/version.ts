/** The package version, read from package.json so the entries and the inline runtime cannot drift. */

import pkg from '../package.json' with { type: 'json' };

/** The version of this package, as its `package.json` states it. */
export const VERSION: string = pkg.version;
