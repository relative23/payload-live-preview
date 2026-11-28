/** Tracks the announced protocol version and the capabilities seen on the wire. */

import {
  LIBRARY_PROTOCOL_VERSION,
  negotiateProtocol,
  PAYLOAD_2_REFUSED,
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
    // Said once, in every build: from here on the pipeline applies nothing of this peer.
    if (fresh.includes('schema-json')) warn(PAYLOAD_2_REFUSED);
  }

  /** Whether the peer showed the schema only Payload 2 sends; its updates are refused (LP0504). */
  get unsupported(): boolean {
    return this.observed.has('schema-json');
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
