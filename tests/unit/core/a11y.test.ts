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

  it('keeps the shared live region mounted while another announcer still leases it', () => {
    const a = new A11yAnnouncer('en');
    const b = new A11yAnnouncer('en');
    a.announceConnected();
    b.announceUpdate(2);

    const element = document.getElementById(ID);
    expect(document.querySelectorAll(`#${ID}`)).toHaveLength(1);
    expect(element?.textContent).toBe('2 changes applied');

    a.detach();

    expect(document.getElementById(ID)).toBe(element);
    b.announceUpdate(3);
    expect(element?.textContent).toBe('3 changes applied');

    b.detach();
    expect(document.getElementById(ID)).toBeNull();
  });

  it('does not let an older announcer timer clear a newer shared announcement', () => {
    const a = new A11yAnnouncer('en');
    const b = new A11yAnnouncer('en');
    a.announceConnected();

    vi.advanceTimersByTime(1000);
    const ineffectiveClearTimeout = vi
      .spyOn(globalThis, 'clearTimeout')
      .mockImplementation(() => undefined);
    try {
      b.announceUpdate(2);
      a.detach();

      // The first timer really runs here. The shared generation guard, rather
      // than successful platform cancellation, keeps B's message intact.
      vi.advanceTimersByTime(500);
      expect(document.getElementById(ID)?.textContent).toBe('2 changes applied');

      vi.advanceTimersByTime(1000);
      expect(document.getElementById(ID)?.textContent).toBe('');
    } finally {
      ineffectiveClearTimeout.mockRestore();
    }
    b.detach();
  });

  it('removes a package-owned region only after the final lease is released', () => {
    const a = new A11yAnnouncer('en');
    const b = new A11yAnnouncer('en');
    a.announceConnected();
    b.announceConnected();

    const element = document.getElementById(ID);
    expect(vi.getTimerCount()).toBe(1);
    a.detach();
    expect(document.getElementById(ID)).toBe(element);
    expect(vi.getTimerCount()).toBe(1);

    b.detach();
    expect(document.getElementById(ID)).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('never removes a pre-existing consumer-owned live region', () => {
    const consumerElement = document.createElement('div');
    consumerElement.id = ID;
    consumerElement.setAttribute('role', 'log');
    document.body.appendChild(consumerElement);

    const a = new A11yAnnouncer('en');
    const b = new A11yAnnouncer('de');
    a.announceConnected();
    b.announceUpdate(2);

    a.detach();
    b.detach();

    expect(document.getElementById(ID)).toBe(consumerElement);
    expect(consumerElement.getAttribute('role')).toBe('log');
    expect(consumerElement.textContent).toBe('');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not clear newer consumer text when the final adopted lease detaches', () => {
    const consumerElement = document.createElement('div');
    consumerElement.id = ID;
    document.body.appendChild(consumerElement);
    const announcer = new A11yAnnouncer('en');
    announcer.announceConnected();

    consumerElement.textContent = 'consumer-owned newer announcement';
    announcer.detach();

    expect(consumerElement.textContent).toBe('consumer-owned newer announcement');
  });

  it('does not let the package timer clear newer text in an adopted region', () => {
    const consumerElement = document.createElement('div');
    consumerElement.id = ID;
    document.body.appendChild(consumerElement);
    const announcer = new A11yAnnouncer('en');
    announcer.announceConnected();

    consumerElement.textContent = 'consumer-owned newer announcement';
    vi.advanceTimersByTime(2000);

    expect(consumerElement.textContent).toBe('consumer-owned newer announcement');
    announcer.detach();
  });

  it('restores pre-existing consumer text after an adopted announcement expires', () => {
    const consumerElement = document.createElement('div');
    consumerElement.id = ID;
    consumerElement.textContent = 'consumer baseline';
    document.body.appendChild(consumerElement);
    const announcer = new A11yAnnouncer('en');
    announcer.announceConnected();

    vi.advanceTimersByTime(2000);

    expect(consumerElement.textContent).toBe('consumer baseline');
    announcer.detach();
  });

  it('restores the exact consumer child nodes after an adopted announcement expires', () => {
    const consumerElement = document.createElement('div');
    consumerElement.id = ID;
    const text = document.createTextNode('consumer ');
    const strong = document.createElement('strong');
    strong.textContent = 'baseline';
    consumerElement.append(text, strong);
    document.body.appendChild(consumerElement);
    const announcer = new A11yAnnouncer('en');

    announcer.announceConnected();
    vi.advanceTimersByTime(2000);

    expect(consumerElement.childNodes).toHaveLength(2);
    expect(consumerElement.childNodes[0]).toBe(text);
    expect(consumerElement.childNodes[1]).toBe(strong);
    announcer.detach();
  });

  it('restores the exact consumer child nodes when the final lease detaches early', () => {
    const consumerElement = document.createElement('div');
    consumerElement.id = ID;
    const label = document.createElement('span');
    label.textContent = 'consumer baseline';
    consumerElement.appendChild(label);
    document.body.appendChild(consumerElement);
    const a = new A11yAnnouncer('en');
    const b = new A11yAnnouncer('de');

    a.announceConnected();
    b.announceConnected();
    a.detach();
    b.detach();

    expect(consumerElement.firstChild).toBe(label);
  });

  it('does not replace a same-text node written by the consumer', () => {
    const consumerElement = document.createElement('div');
    consumerElement.id = ID;
    const baseline = document.createElement('span');
    baseline.textContent = 'baseline';
    consumerElement.appendChild(baseline);
    document.body.appendChild(consumerElement);
    const announcer = new A11yAnnouncer('en');
    announcer.announceConnected();

    const consumerMessage = document.createTextNode('Live preview connected');
    consumerElement.replaceChildren(consumerMessage);
    vi.advanceTimersByTime(2000);

    expect(consumerElement.firstChild).toBe(consumerMessage);
    announcer.detach();
    expect(consumerElement.firstChild).toBe(consumerMessage);
  });

  it('removes a reparented package message before creating its replacement', () => {
    const consumerElement = document.createElement('div');
    consumerElement.id = ID;
    document.body.appendChild(consumerElement);
    const outside = document.createElement('aside');
    document.body.appendChild(outside);
    const announcer = new A11yAnnouncer('en');
    announcer.announceConnected();

    const packageMessage = consumerElement.firstChild;
    if (packageMessage === null) throw new Error('package message missing');
    outside.appendChild(packageMessage);
    announcer.announceUpdate(2);

    expect(outside.childNodes).toHaveLength(0);
    expect(consumerElement.textContent).toBe('2 changes applied');
    announcer.detach();
    expect(outside.childNodes).toHaveLength(0);
    outside.remove();
  });

  it('can acquire a fresh lease after an idempotent detach', () => {
    const announcer = new A11yAnnouncer('en');
    announcer.announceConnected();
    const firstElement = document.getElementById(ID);

    announcer.detach();
    announcer.detach();
    expect(document.getElementById(ID)).toBeNull();

    announcer.announceUpdate(1);
    const secondElement = document.getElementById(ID);
    expect(secondElement).not.toBeNull();
    expect(secondElement).not.toBe(firstElement);
    expect(secondElement?.textContent).toBe('1 change applied');

    announcer.detach();
  });

  it('reacquires exactly one reference while a peer still holds the shared lease', () => {
    const a = new A11yAnnouncer('en');
    const b = new A11yAnnouncer('en');
    a.announceConnected();
    b.announceConnected();

    a.detach();
    a.detach();
    a.announceUpdate(4);

    const element = document.getElementById(ID);
    b.detach();
    expect(document.getElementById(ID)).toBe(element);

    a.detach();
    expect(document.getElementById(ID)).toBeNull();
  });

  it('keeps its constructor document target stable when the global document changes', () => {
    const originalDocument = globalThis.document;
    const otherDocument = document.implementation.createHTMLDocument('other');
    const announcer = new A11yAnnouncer('en');

    try {
      globalThis.document = otherDocument;
      announcer.announceConnected();
      expect(otherDocument.getElementById(ID)).toBeNull();
      const originalElement = originalDocument.getElementById(ID);
      expect(originalElement).not.toBeNull();

      globalThis.document = originalDocument;
      announcer.announceUpdate(2);

      expect(originalDocument.getElementById(ID)).toBe(originalElement);
      expect(originalDocument.getElementById(ID)?.textContent).toBe('2 changes applied');
    } finally {
      announcer.detach();
      globalThis.document = originalDocument;
    }
  });

  it('revokes a package-owned region adopted into another document before replacement', () => {
    const otherDocument = document.implementation.createHTMLDocument('other');
    const announcer = new A11yAnnouncer('en');
    announcer.announceConnected();
    const original = document.getElementById(ID);
    if (original === null) throw new Error('package region missing');
    otherDocument.body.appendChild(otherDocument.adoptNode(original));

    announcer.announceUpdate(2);
    const replacement = document.getElementById(ID);
    expect(replacement).not.toBeNull();
    expect(replacement).not.toBe(original);
    expect(original.isConnected).toBe(false);
    expect(otherDocument.getElementById(ID)).toBeNull();

    announcer.detach();
    expect(document.getElementById(ID)).toBeNull();
    expect(otherDocument.getElementById(ID)).toBeNull();
  });

  it('isolates explicitly targeted documents without changing the global document', () => {
    const firstDocument = document.implementation.createHTMLDocument('first');
    const secondDocument = document.implementation.createHTMLDocument('second');
    const first = new A11yAnnouncer('en', firstDocument);
    const second = new A11yAnnouncer('de', secondDocument);

    first.announceConnected();
    second.announceConnected();

    expect(firstDocument.getElementById(ID)?.textContent).toBe('Live preview connected');
    expect(secondDocument.getElementById(ID)?.textContent).toBe('Vorschau verbunden');
    expect(document.getElementById(ID)).toBeNull();

    first.detach();
    expect(firstDocument.getElementById(ID)).toBeNull();
    expect(secondDocument.getElementById(ID)).not.toBeNull();
    second.detach();
  });

  it('drops announcements while the active document has no body and mounts later', () => {
    const announcer = new A11yAnnouncer('en');
    const body = document.body;
    body.remove();

    try {
      announcer.announceConnected();
      expect(document.getElementById(ID)).toBeNull();
    } finally {
      document.documentElement.appendChild(body);
    }

    announcer.announceConnected();
    expect(document.getElementById(ID)?.textContent).toBe('Live preview connected');
    announcer.detach();
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
