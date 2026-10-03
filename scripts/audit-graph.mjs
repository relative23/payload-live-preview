/**
 * Bind a reviewed advisory to every affected node in the actual audit and lock.
 * Caller suggestions and locked identities remain part of the digest, so a new
 * compatible fix or changed dependency path requires another review.
 */
// @ts-check
import { createHash } from 'node:crypto';

/** @typedef {Record<string, unknown>} ObjectValue */
/** @typedef {{readonly id: string, readonly package: string, readonly severity: string, readonly advisoryPackage?: string}} AuditGraphFinding */

/** @param {unknown} value @returns {value is ObjectValue} */
function object(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/** @param {unknown} condition @param {string} message @returns {asserts condition} */
function requireValue(condition, message) {
  if (!condition) throw new Error(`audit-gate: ${message}`);
}
/** @param {unknown} value @returns {value is string[]} */
function strings(value) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}
/** @param {string | Uint8Array} value @returns {string} */
function sha(value) {
  return createHash('sha256').update(value).digest('hex');
}
/** @param {unknown} value @returns {string} */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (object(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  }
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') {
    return 'null';
  }
  return JSON.stringify(value);
}

/**
 * @param {unknown} audit
 * @param {unknown} lock
 * @param {readonly AuditGraphFinding[]} findings
 * @param {string} leaf
 * @param {string} id
 * @returns {{sha256: string, version: string, integrity: string}}
 */
export function advisoryGraph(audit, lock, findings, leaf, id) {
  requireValue(
    object(audit) && object(audit['vulnerabilities']) && object(lock) && object(lock['packages']),
    'missing audit/lock graph',
  );
  const vulnerabilities = audit['vulnerabilities'];
  const packages = lock['packages'];
  const leafEntry = vulnerabilities[leaf];
  requireValue(
    object(leafEntry) && Array.isArray(leafEntry['via']),
    `missing advisory leaf ${leaf}`,
  );
  const fix = leafEntry['fixAvailable'];
  requireValue(
    typeof fix === 'boolean' ||
      (object(fix) &&
        typeof fix['isSemVerMajor'] === 'boolean' &&
        typeof fix['name'] === 'string' &&
        typeof fix['version'] === 'string'),
    `missing fix suggestion for ${leaf}`,
  );
  const affected = [
    ...new Set(
      findings
        .filter((finding) => finding.advisoryPackage === leaf && finding.id === id)
        .map((finding) => finding.package),
    ),
  ].sort();
  requireValue(affected.includes(leaf), `missing leaf ${leaf}`);
  /** @type {ObjectValue[]} */
  const nodes = [];
  /** @type {Set<string>} */
  const versions = new Set();
  /** @type {Set<string>} */
  const integrities = new Set();
  for (const name of affected) {
    const entry = vulnerabilities[name];
    requireValue(
      object(entry) && strings(entry['nodes']) && entry['nodes'].length > 0,
      `missing nodes for ${name}`,
    );
    for (const path of [...entry['nodes']].sort()) {
      requireValue(
        path.startsWith('node_modules/') &&
          !path.split('/').includes('..') &&
          path.endsWith(`node_modules/${name}`),
        `invalid node ${path}`,
      );
      const node = packages[path];
      requireValue(object(node), `missing locked node ${path}`);
      if (name === 'payload-live-preview') {
        requireValue(node['resolved'] === 'file:../..', 'changed local product reference');
        nodes.push({
          package: name,
          path,
          local: true,
          peerDependencies: node['peerDependencies'] ?? null,
          fixAvailable: entry['fixAvailable'] ?? null,
        });
      } else {
        requireValue(
          typeof node['version'] === 'string' && typeof node['integrity'] === 'string',
          `missing locked identity ${path}`,
        );
        nodes.push({
          package: name,
          path,
          version: node['version'],
          integrity: node['integrity'],
          dependencies: node['dependencies'] ?? null,
          peerDependencies: node['peerDependencies'] ?? null,
          fixAvailable: entry['fixAvailable'] ?? null,
        });
        if (name === leaf) {
          versions.add(node['version']);
          integrities.add(node['integrity']);
        }
      }
    }
  }
  requireValue(versions.size === 1 && integrities.size === 1, `ambiguous leaf identity ${leaf}`);
  const advisories = leafEntry['via'].filter(object).map((via) => ({
    id: via['url'] ?? via['source'],
    severity: via['severity'],
    range: via['range'] ?? null,
  }));
  const version = [...versions][0];
  const integrity = [...integrities][0];
  requireValue(
    typeof version === 'string' && typeof integrity === 'string',
    'missing leaf identity',
  );
  return { sha256: sha(canonical({ nodes, fix, advisories })), version, integrity };
}
