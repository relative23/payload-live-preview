/**
 * Public detection barrel.
 *
 * @module @detection
 */

export { isInIframe, isInPopup, isInPreviewContext, isDevMode, getEnvVar } from './environment';

export {
  OriginDetector,
  normaliseOrigin,
  isLocalhostOrigin,
  type OriginDetectorOptions,
} from './origin';

export { detectInitialLocale } from './locale';
