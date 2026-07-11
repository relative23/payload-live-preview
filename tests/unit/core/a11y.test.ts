import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { A11yAnnouncer } from '@core/a11y';

const ID = 'payload-live-preview-a11y';

beforeEach(() => {
  vi.useFakeTimers();
  document.getElementById(ID)?.remove();
});

afterEach(() => {
  vi.useRealTimers();
  document.getElementById(ID)?.remove();
});

describe('A11yAnnouncer — element mounting', () => {
  it('mounts lazily: no DOM node until the first announcement', () => {
    // Lazy mounting matters because the announcer can be constructed
    // from a <head> inline script while document.body is still null.
    const announcer = new A11yAnnouncer('en');
    expect(document.getElementById(ID)).toBeNull();

    announcer.announceConnected();
    const element = document.getElementById(ID);
    expect(element).not.toBeNull();
    expect(element?.getAttribute('role')).toBe('status');
    expect(element?.getAttribute('aria-live')).toBe('polite');
    expect(element?.getAttribute('aria-atomic')).toBe('true');
    announcer.detach();
  });

  it('reuses an existing live region across multiple instances', () => {
    const a = new A11yAnnouncer('en');
    const b = new A11yAnnouncer('en');
    a.announceConnected();
    b.announceConnected();
    expect(document.querySelectorAll(`#${ID}`)).toHaveLength(1);
    a.detach();
    // After detach the element is gone; b remounts on the next say.
    expect(document.getElementById(ID)).toBeNull();
    b.detach();
  });

  it('detach removes the element from the document', () => {
    const announcer = new A11yAnnouncer('en');
    announcer.detach();
    expect(document.getElementById(ID)).toBeNull();
  });

  it('detach is idempotent', () => {
    const announcer = new A11yAnnouncer('en');
    expect(() => {
      announcer.detach();
      announcer.detach();
    }).not.toThrow();
  });
});

describe('A11yAnnouncer — announcements', () => {
  it('announces "connected" in the requested locale', () => {
    const announcer = new A11yAnnouncer('en');
    announcer.announceConnected();
    expect(document.getElementById(ID)?.textContent).toBe('Live preview connected');
    announcer.detach();
  });

  it('announces "connected" in German', () => {
    const announcer = new A11yAnnouncer('de-AT');
    announcer.announceConnected();
    expect(document.getElementById(ID)?.textContent).toBe('Vorschau verbunden');
    announcer.detach();
  });

  it('falls back to English for unknown locales', () => {
    const announcer = new A11yAnnouncer('zh-CN');
    announcer.announceConnected();
    expect(document.getElementById(ID)?.textContent).toBe('Live preview connected');
    announcer.detach();
  });

  it('announces singular vs plural updates correctly', () => {
    const announcer = new A11yAnnouncer('en');
    announcer.announceUpdate(1);
    expect(document.getElementById(ID)?.textContent).toBe('1 change applied');
    announcer.announceUpdate(7);
    expect(document.getElementById(ID)?.textContent).toBe('7 changes applied');
    announcer.detach();
  });

  it('skips updates with zero count', () => {
    const announcer = new A11yAnnouncer('en');
    announcer.announceUpdate(0);
    expect(document.getElementById(ID)?.textContent ?? '').toBe('');
    announcer.detach();
  });

  it('clears the live region after the throttle window', () => {
    const announcer = new A11yAnnouncer('en');
    announcer.announceConnected();
    expect(document.getElementById(ID)?.textContent).toBe('Live preview connected');
    vi.advanceTimersByTime(2000);
    expect(document.getElementById(ID)?.textContent).toBe('');
    announcer.detach();
  });

  it('announces disconnect', () => {
    const announcer = new A11yAnnouncer('en');
    announcer.announceDisconnected();
    expect(document.getElementById(ID)?.textContent).toBe('Live preview disconnected');
    announcer.detach();
  });
});

describe('A11yAnnouncer — SSR safety', () => {
  it('does not throw when document is unavailable', () => {
    const originalDoc = globalThis.document;
    // @ts-expect-error — simulating SSR
    delete globalThis.document;
    try {
      expect(() => {
        const announcer = new A11yAnnouncer('en');
        announcer.announceConnected();
        announcer.announceUpdate(3);
        announcer.detach();
      }).not.toThrow();
    } finally {
      globalThis.document = originalDoc;
    }
  });
});
