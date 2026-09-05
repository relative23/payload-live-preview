/** Options accepted by `LivePreviewRuntime`. */

import type { EventEmitter } from '@events/emitter';
import type { SanitizerPolicyMode } from '@security/sanitizer';
import type { OriginMatcher } from './message-bus';
import type { StrategyHandlers } from './strategies';
import type { CachedElement, FieldRenderer, RendererKey, RichTextRenderer } from './types';

export interface RuntimeOptions {
  /** Document root containing the bindings. Defaults to `document`. */
  readonly root?: Document | Element;
  /** Map from field type to renderer. */
  readonly renderers: Readonly<Record<string, FieldRenderer>>;
  /** Resolve the active renderer for a field type; defaults to a `renderers` lookup. */
  readonly resolveRenderer?: (
    fieldType: RendererKey,
    target: CachedElement,
  ) => FieldRenderer | undefined;
  /** Project rich-text renderer, handed to the `richText` renderer through its context. */
  readonly renderRichText?: RichTextRenderer;
  /**
   * Sanitizer policy for this instance's rich-text and HTML writes, handed to
   * every renderer through its context. Without one, the process default set
   * by `setSanitizerPolicy()` applies.
   */
  readonly sanitizerPolicy?: SanitizerPolicyMode;
  /**
   * Transform a field value before it is scheduled for a binding. Must be
   * synchronous; the result is frozen for debounce and replay.
   */
  readonly transformValue?: (
    fieldName: string,
    value: unknown,
    context: { readonly element: Element; readonly allFields: Record<string, unknown> },
    /** Stops a transform chain when a synchronous re-entry supersedes this revision. */
    isCurrent?: () => boolean,
  ) => unknown;
  /** Origin matcher for incoming messages. */
  readonly originMatcher: OriginMatcher;
  /** Reads the origin the host locked onto, for `inspect()`. */
  readonly lockedOrigin?: () => string | undefined;
  /**
   * Skip a binding whose value is identical to the one it last applied.
   * Every message carries the whole document, so this saves almost every
   * render per keystroke. Default `false` here; the inline runtime and
   * `defaults: 'v2'` turn it on.
   */
  readonly skipUnchanged?: boolean;
  /** Scroll the preview to the field being edited when its value changes. */
  readonly revealEditedField?: boolean;
  /**
   * Fields whose change re-applies other bindings: `{ price: ['priceLabel'] }`.
   * Merged with what the markup declares via `data-payload-depends`.
   */
  readonly dependencies?: Readonly<Record<string, readonly string[]>>;
  /** Fragment and route strategies; without them every boundary is patched. */
  readonly strategies?: StrategyHandlers;
  /**
   * Origins to broadcast `ready` to. Read per handshake, so a re-`start()`
   * after an origin lock narrows it instead of re-broadcasting to every
   * pre-lock candidate.
   */
  readonly readyTargets: readonly string[] | (() => readonly string[]);
  /** Per-instance event emitter. */
  readonly emitter: EventEmitter;
  /** Debounce window in ms. */
  readonly debounceMs?: number;
  /** Heartbeat timeout in ms; `0` disables it. */
  readonly heartbeatMs?: number;
  /** `rootMargin` for the IntersectionObserver. */
  readonly intersectionRootMargin?: string;
  /**
   * Restrict every update to bindings owned by the document the message
   * describes (`data-payload-owner`). Unowned bindings are then out of scope.
   */
  readonly scopeBindingsByOwner?: boolean;
  /** Which windows may post updates. `defaults: 'v2'` sets `'parent-or-opener'`. */
  readonly eventSourcePolicy?: 'any' | 'parent-or-opener';
  /** Apply every update regardless of visibility. */
  readonly disableVisibilityGate?: boolean;
  /** Cache size above which off-screen updates are buffered for replay. Default 50. */
  readonly visibilityGateThreshold?: number;
  /** Mount an `aria-live` region for connection and update announcements. Default `true`. */
  readonly enableA11y?: boolean;
  /** Locale for announcement strings; detected from the document by default. */
  readonly a11yLocale?: string;
  /** Called whenever the runtime (re)sends the ready handshake. */
  readonly sendReady?: (origins: readonly string[]) => void;
  /** Called when the heartbeat times out, so the host can release its origin lock. */
  readonly onHeartbeatTimeout?: () => void;
  /**
   * Preview-token validator. The stock Payload admin sends no token, so enable
   * this only with a custom admin component that attaches one.
   */
  readonly validateToken?: (
    token: string | undefined,
    origin: string,
  ) => boolean | Promise<boolean>;
  /**
   * Re-fetch every update through the Payload REST API so relationship and
   * upload fields arrive populated. Failures fall back to the raw form values.
   */
  readonly dataMerge?: {
    readonly serverURL: string;
    /** REST route prefix. Defaults to `/api`. */
    readonly apiRoute?: string;
    /** Population depth. */
    readonly depth?: number;
    readonly fetchFn?: typeof fetch;
  };
  /** Debug log sink. */
  readonly log?: (...args: unknown[]) => void;
  /** Warning sink for consumer mistakes; deduplicated per field. Defaults to `console.warn`. */
  readonly warn?: (...args: unknown[]) => void;
}
