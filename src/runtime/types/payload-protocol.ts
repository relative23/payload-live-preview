/**
 * Payload's live-preview `postMessage` protocol as the shipped admin sends it:
 * raw form values on every edit, no schema. `previewToken` and
 * `protocolVersion` are extensions of this library for custom senders.
 */

export interface PayloadLivePreviewMessage {
  readonly type: 'payload-live-preview';
  readonly data?: Record<string, unknown>;
  readonly globalSlug?: string;
  readonly collectionSlug?: string;
  readonly locale?: string;
  readonly ready?: boolean;
  /** Payload 3.x: the most recent relationship-document event (a drawer save), or `null`. */
  readonly externallyUpdatedRelationship?: PayloadDocumentEventDetail | null;
  /** Library extension: the token `validateToken` checks. Stock Payload never sends one. */
  readonly previewToken?: string;
  /** Library extension: the highest protocol version the sender supports; absent means v1. */
  readonly protocolVersion?: number;
}

/** Payload's `DocumentEvent` shape (admin `providers/DocumentEvents`). */
export interface PayloadDocumentEventDetail {
  readonly entitySlug: string;
  readonly operation?: 'create' | 'update';
  readonly id?: string | number;
  readonly updatedAt?: string;
  readonly [extra: string]: unknown;
}

/** Sent on save. Stock Payload 3.x sends the bare `{ type }`; the other fields come from custom senders. */
export interface PayloadDocumentEventMessage {
  readonly type: 'payload-document-event';
  readonly action?: 'updated' | 'created' | 'deleted';
  readonly slug?: string;
  readonly id?: string | number;
}

export type PayloadProtocolMessage = PayloadLivePreviewMessage | PayloadDocumentEventMessage;

/** A validated update as events expose it. */
export interface PayloadLivePreviewData {
  readonly fields: Record<string, unknown>;
  readonly globalSlug?: string;
  readonly collectionSlug?: string;
  readonly locale?: string;
}

/** Payload's core field types. `tabs` is a structural container; `group` flattens. */
export type PayloadFieldType =
  | 'text'
  | 'textarea'
  | 'richText'
  | 'email'
  | 'number'
  | 'checkbox'
  | 'date'
  | 'select'
  | 'radio'
  | 'array'
  | 'blocks'
  | 'group'
  | 'tabs'
  | 'row'
  | 'collapsible'
  | 'relationship'
  | 'upload'
  | 'point'
  | 'json'
  | 'code'
  | 'ui';
