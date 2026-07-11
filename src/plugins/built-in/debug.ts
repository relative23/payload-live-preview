/**
 * `debug` plugin — logs every lifecycle event via the plugin context.
 *
 * @module @plugins/built-in/debug
 */

import type { LivePreviewPlugin } from '../types';

export const debugPlugin: LivePreviewPlugin = {
  name: 'debug',
  version: '1.0.0',
  init: (ctx) => {
    ctx.events.on('init', () => {
      ctx.log('init');
    });
    ctx.events.on('connect', (e) => {
      ctx.log('connect ←', e.origin);
    });
    ctx.events.on('disconnect', (e) => {
      ctx.log('disconnect (', e.reason, ')');
    });
    ctx.events.on('cacheRefresh', (e) => {
      ctx.log('cacheRefresh', e.elementCount, 'elements,', e.fieldCount, 'fields');
    });
    ctx.events.on('beforeUpdate', (e) => {
      ctx.log('beforeUpdate', Object.keys(e.data.fields).length, 'fields');
    });
    ctx.events.on('afterUpdate', (e) => {
      ctx.log('afterUpdate', e.updatedCount, 'in', e.durationMs.toFixed(2), 'ms');
    });
    ctx.events.on('error', (e) => {
      ctx.log('error in', e.context, ':', e.error.message);
    });
  },
};
