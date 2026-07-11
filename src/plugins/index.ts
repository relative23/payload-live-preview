/**
 * Public plugin barrel.
 *
 * @module @plugins
 */

export { PluginManager, type PluginManagerOptions } from './manager';
export { type LivePreviewPlugin, type PluginContext, type FieldTransform } from './types';

export { highlightPlugin } from './built-in/highlight';
export { debugPlugin } from './built-in/debug';
export { createAnalyticsPlugin, type AnalyticsSnapshot } from './built-in/analytics';
export {
  documentSavePlugin,
  type DocumentSavePluginOptions,
  type DocumentSaveStrategy,
} from './built-in/document-save';
