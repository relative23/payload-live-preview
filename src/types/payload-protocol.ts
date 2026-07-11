/**
 * Payload Live Preview message protocol.
 *
 * Mirrors the messages emitted by Payload CMS 2.x and 3.x through
 * `window.postMessage`. The shape is documented from the Payload
 * source — keep this in sync when Payload evolves the protocol.
 *
 * @module @/types/payload-protocol
 */

/**
 * A `payload-live-preview` data update.
 *
 * `data` is the serialized document state. `fieldSchemaJSON`, when
 * present, allows the schema-driven engine to resolve field types
 * without any DOM annotations from the consumer.
 */
export interface PayloadLivePreviewMessage {
  readonly type: 'payload-live-preview';
  readonly data?: Record<string, unknown>;
  readonly fieldSchemaJSON?: readonly PayloadFieldSchema[];
  readonly globalSlug?: string;
  readonly collectionSlug?: string;
  readonly locale?: string;
  readonly ready?: boolean;
  /**
   * Optional preview JWT issued by Payload. When `RuntimeOptions.tokenValidator`
   * is set, the runtime requires every data update to carry a token that
   * passes the validator; messages without a valid token are dropped.
   */
  readonly previewToken?: string;
  /**
   * Highest protocol version the sender supports. Both `ready`
   * handshakes and `data` updates may include this so each side can
   * negotiate the minimum shared version (`min(ours, theirs)`). When
   * absent, the receiver assumes v1.
   */
  readonly protocolVersion?: number;
}

/**
 * A `payload-document-event` message — published when the document is
 * saved in the admin panel. We surface it as an event so the consumer
 * can revalidate caches, refresh server-rendered fragments, etc.
 */
export interface PayloadDocumentEventMessage {
  readonly type: 'payload-document-event';
  readonly action?: 'updated' | 'created' | 'deleted';
  readonly slug?: string;
  readonly id?: string | number;
}

export type PayloadProtocolMessage = PayloadLivePreviewMessage | PayloadDocumentEventMessage;

/**
 * Parsed, validated message payload exposed to consumers via events.
 */
export interface PayloadLivePreviewData {
  readonly fields: Record<string, unknown>;
  readonly schema?: readonly PayloadFieldSchema[];
  readonly globalSlug?: string;
  readonly collectionSlug?: string;
  readonly locale?: string;
}

/**
 * The subset of Payload's field-schema description we rely on.
 *
 * Payload emits the entire field configuration tree but we only need
 * the discriminator `type` and the nesting via `fields`/`blocks`.
 * Extra properties are preserved opaquely.
 */
export interface PayloadFieldSchema {
  readonly name: string;
  readonly type: PayloadFieldType;
  readonly label?: string;
  readonly required?: boolean;
  readonly localized?: boolean;
  readonly fields?: readonly PayloadFieldSchema[];
  readonly blocks?: readonly PayloadBlockSchema[];
  readonly relationTo?: string | readonly string[];
  readonly hasMany?: boolean;
  readonly admin?: { readonly condition?: PayloadFieldCondition };
  readonly [extra: string]: unknown;
}

export interface PayloadBlockSchema {
  readonly slug: string;
  readonly fields: readonly PayloadFieldSchema[];
  readonly [extra: string]: unknown;
}

/**
 * The 14 Payload core field types. `tabs` is treated as a structural
 * container; `group` flattens nested fields.
 */
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

/**
 * Payload's `admin.condition` is a function in source, but it cannot
 * be transferred over postMessage. The schema arrives with this slot
 * either absent or, in future Payload versions, replaced by a
 * serialized expression. We model the slot but do not consume it yet.
 */
export type PayloadFieldCondition = (data: unknown, siblingData: unknown) => boolean;
