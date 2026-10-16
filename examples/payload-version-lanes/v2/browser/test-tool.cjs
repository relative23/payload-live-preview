/**
 * Resolve only the explicitly selected repository's reviewed browser tooling.
 * The materialized harness may live under /tmp; admin, React and SDK resolution
 * still use the isolated app and receive no repository peer fallback.
 */
const assert = require('node:assert/strict');
const { readFileSync, realpathSync } = require('node:fs');
const { createRequire } = require('node:module');
const { join, sep } = require('node:path');
const root = realpathSync(process.env.PLP_VERSION_LANES_REPO);
const modules = realpathSync(join(root, 'node_modules'));
assert.equal(modules, join(root, 'node_modules'));
const tool = realpathSync(join(modules, '@playwright/test'));
assert.ok(tool.startsWith(modules + sep));
assert.equal(JSON.parse(readFileSync(join(tool, 'package.json'), 'utf8')).version, '1.62.1');
const entry = realpathSync(createRequire(join(root, 'package.json')).resolve('@playwright/test'));
assert.ok(entry.startsWith(tool + sep));
module.exports = require(entry);
