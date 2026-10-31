/** Tracks the announced protocol version and the capabilities seen on the wire. */

import { isDevMode } from '@detection/environment';
import {
  LIBRARY_PROTOCOL_VERSION,
  negotiateProtocol,
  PAYLOAD_2_HINT,
  type ProtocolCapability,
  type ProtocolNegotiation,
} from './protocol-version';

export class ProtocolTracker {
  negotiation: ProtocolNegotiation = negotiateProtocol(undefined);
  readonly observed = new Set<ProtocolCapability>();

  /** Record capabilities a message demonstrated; the stock admin announces no version. */
  observe(
    capabilities: readonly ProtocolCapability[],
    log: (...args: unknown[]) => void,
    warn: (...args: unknown[]) => void,
  ): void {
    const fresh = capabilities.filter((capability) => !this.observed.has(capability));
    if (fresh.length === 0) return;
    for (const capability of fresh) this.observed.add(capability);
    this.negotiation = negotiateProtocol(this.negotiation.theirs, this.observed);
    log('protocol', `observed=${fresh.join(',')}`);
    // A byte trade like the lean profile's others: it drops the hint, not Payload 2's behaviour.
    if (
      !(typeof __LEAN_BUILD__ !== 'undefined' && __LEAN_BUILD__) &&
      fresh.includes('schema-json') &&
      isDevMode()
    ) {
      warn(PAYLOAD_2_HINT);
    }
  }

  applyVersion(remoteVersion: number, log: (...args: unknown[]) => void): void {
    const current = this.negotiation;
    if (current.theirs === remoteVersion) return;
    const next = negotiateProtocol(remoteVersion, this.observed);
    this.negotiation = next;
    if (next.negotiated === current.negotiated) return;
    log(
      'protocol',
      `ours=${LIBRARY_PROTOCOL_VERSION}`,
      `theirs=${remoteVersion}`,
      `negotiated=${next.negotiated}`,
    );
  }
}
