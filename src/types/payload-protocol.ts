/**
 * Payload Live Preview message protocol.
 *
 * Mirrors the messages emitted by Payload CMS through
 * `window.postMessage`, verified against the shipped admin code
 * (`@payloadcms/ui` → `elements/LivePreview/Window`):
 *
 *   - Payload **3.x** sends `{ type, collectionSlug, globalSlug, data,
 *     locale, externallyUpdatedRelationship }` on every form edit —
 *     `data` holds **raw form values** (relationships as bare IDs) and
 *     there is **no** `fieldSchemaJSON`.
 *   - Payload **2.x** additionally sent `fieldSchemaJSON` with the
 *     first update (client-side merge era).
 *   - `previewToken` and `protocolVersion` are extensions of THIS
 *     library for custom admin senders; stock Payload never sends
 *     them and ignores them in our `ready` handshake.
 *
 * @module @/types/payload-protocol
 */

/**
 * A `payload-live-preview` data update.
 *
 * `data` is the serialized document state. `fieldSchemaJSON`, when
 * present (Payload 2.x or custom senders), allows the schema-driven
 * engine to resolve field types without any DOM annotations.
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
   * Payload 3.x: most recent relationship-document event (create/update
   * in a drawer), or `null`. The official client ignores it too — it is
   * modeled here for completeness and consumer event access.
   */
  readonly externallyUpdatedRelationship?: PayloadDocumentEventDetail | null;
  /**
   * Optional preview JWT. ⚠️ Library extension — stock Payload never
   * sends one. When `RuntimeOptions.validateToken` is set, the runtime
   * requires every data update to carry a token that passes the
   * validator; messages without a valid token are dropped.
   */
  readonly previewToken?: string;
  /**
   * Highest protocol version the sender supports. ⚠️ Library extension
   * for custom senders — stock Payload sends no version. When absent,
   * the receiver assumes v1.
   */
  readonly protocolVersion?: number;
}

/**
 * Payload's `DocumentEvent` shape (admin `providers/DocumentEvents`).
 */
export interface PayloadDocumentEventDetail {
  readonly entitySlug: string;
  readonly operation?: 'create' | 'update';
  readonly id?: string | number;
  readonly updatedAt?: string;
  readonly [extra: string]: unknown;
}

/**
 * A `payload-document-event` message — published when the document is
 * saved in the admin panel. Stock Payload 3.x sends a **bare**
 * `{ type: 'payload-document-event' }` with no further fields; the
 * optional fields below only appear from custom senders. We surface it
 * as a `documentSave` event so the consumer can revalidate caches.
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
 * The Payload core field types this library recognises (20 as of
 * Payload 3.x). `tabs` is treated as a structural container; `group`
 * flattens nested fields.
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
