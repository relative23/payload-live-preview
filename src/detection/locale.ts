/**
 * Locale detection.
 *
 * The runtime needs a sensible default locale for date/number renders
 * before Payload tells us the active locale. Order of precedence:
 *
 *   1. The `lang` attribute on `<html>`.
 *   2. `navigator.language`.
 *   3. The hard-coded fallback `'en'`.
 *
 * The previous version of this library defaulted to `'de'` — a German
 * default that surprised consumers in other locales. We now use the
 * browser hint and fall back to English.
 *
 * @module @detection/locale
 */

const FALLBACK_LOCALE = 'en';

/**
 * Returns a BCP-47 locale string suitable for `Intl.*` constructors.
 *
 * Always returns a non-empty string. When no signal is available the
 * fallback (`'en'`) is returned.
 */
export function detectInitialLocale(): string {
  const fromHtml = readHtmlLang();
  if (fromHtml !== undefined) return fromHtml;
  const fromNavigator = readNavigatorLanguage();
  if (fromNavigator !== undefined) return fromNavigator;
  return FALLBACK_LOCALE;
}

function readHtmlLang(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const lang = document.documentElement.getAttribute('lang');
  return lang === null || lang.length === 0 ? undefined : lang;
}

function readNavigatorLanguage(): string | undefined {
  if (typeof navigator === 'undefined') return undefined;
  const lang = navigator.language;
  return typeof lang === 'string' && lang.length > 0 ? lang : undefined;
}
