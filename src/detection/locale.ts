/** The locale for `Intl` renders before Payload names one: `<html lang>`, then `navigator.language`, then `'en'`. */

const FALLBACK_LOCALE = 'en';

export function detectInitialLocale(): string {
  return readHtmlLang() ?? readNavigatorLanguage() ?? FALLBACK_LOCALE;
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
