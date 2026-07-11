/**
 * Public barrel for core runtime primitives.
 *
 * @module @core
 */

export {
  ElementCache,
  resolveFieldType,
  FIELD_ATTRIBUTE,
  TYPE_ATTRIBUTE,
  HREF_ATTRIBUTE,
  SRC_ATTRIBUTE,
  ALT_ATTRIBUTE,
  ARRAY_TEMPLATE_ATTRIBUTE,
  ARRAY_SEPARATOR_ATTRIBUTE,
  LOCALE_ATTRIBUTE,
  type CacheBuildStats,
  type ElementCacheOptions,
} from './cache';
export { ObserverManager, type ObserverCallbacks, type ObserverOptions } from './observers';
export { MessageBus, type MessageHandlers, type OriginMatcher } from './message-bus';
export {
  UpdateScheduler,
  type ApplyUpdate,
  type FlushStats,
  type ScheduledUpdate,
  type UpdateSchedulerOptions,
} from './update-scheduler';
export {
  ConnectionState,
  HeartbeatTimer,
  type ConnectionStatus,
  type HeartbeatOptions,
} from './state';
export { LivePreviewRuntime, resolveFieldValue, type RuntimeOptions } from './lifecycle';
export type {
  CachedElement,
  ElementPredicate,
  FieldRenderer,
  FieldType,
  RenderContext,
} from './types';
