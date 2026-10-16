/**
 * Payload 2 posts raw form values and a schema, rather than a server merge target.
 * Plan collection GETs from that schema and fill an independent document only
 * after every requested identity is present; the caller owns request cancellation.
 */
import type { PayloadFieldSchema } from '@/types/payload-protocol';
import { isPlainObject } from './message-guards';

const MAX_DEPTH = 64;
const MAX_NODES = 10_000;
const MAX_IDS = 1_000;
const MAX_REQUESTS = 64;
const MAX_URL = 8_192;
const MAX_BODY = 1_048_576;
const MAX_CHUNKS = 10_000;
const CHUNK = 20;
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);
type RecordValue = Record<string, unknown>;
interface Slot {
  readonly owner: RecordValue | unknown[];
  readonly key: string | number;
  readonly id: string;
}
export interface LegacyRequest {
  readonly url: string;
  readonly ids: ReadonlySet<string>;
  readonly slots: readonly Slot[];
}
export interface LegacyPlan {
  readonly doc: RecordValue;
  readonly requests: readonly LegacyRequest[];
}

function fail(): never {
  throw new Error('invalid or oversized legacy population');
}
function hasControl(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}
function segment(value: unknown, maximum: number): value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maximum ||
    value === '.' ||
    value === '..'
  ) {
    return false;
  }
  if (value.includes('/') || value.includes('\\') || hasControl(value)) return false;
  try {
    encodeURIComponent(value);
    return true;
  } catch {
    return false;
  }
}
function slug(value: unknown): value is string {
  return segment(value, 128) && !/[?#%]/u.test(value) && !FORBIDDEN.has(value);
}
function id(value: unknown): string {
  if (Number.isFinite(value)) return String(value);
  if (segment(value, 512)) return value;
  return fail();
}
function own(record: RecordValue | unknown[], key: string | number): unknown {
  return Object.hasOwn(record, key) ? Reflect.get(record, key) : undefined;
}
function put(record: RecordValue | unknown[], key: string | number, value: unknown): void {
  Object.defineProperty(record, key, {
    value,
    writable: true,
    configurable: true,
    enumerable: true,
  });
}
function stripTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) end -= 1;
  return value.slice(0, end);
}

/** Copy only structured data, bounded before the planner follows any relation. */
export function copyLegacyData(value: unknown): unknown {
  const active = new WeakSet();
  let nodes = 0;
  let characters = 0;
  function copy(value: unknown, depth: number): unknown {
    if (++nodes > MAX_NODES || depth > MAX_DEPTH) return fail();
    if (typeof value === 'string') {
      characters += value.length;
      if (characters > MAX_BODY) fail();
      return value;
    }
    if (value === null || value === undefined || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : fail();
    if (!Array.isArray(value) && !isPlainObject(value)) return fail();
    if (Array.isArray(value)) {
      if (value.length > MAX_NODES) fail();
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) fail();
      }
    }
    if (active.has(value)) return fail();
    active.add(value);
    const result: RecordValue | unknown[] = Array.isArray(value) ? [] : {};
    for (const key of Object.keys(value)) {
      put(result, key, copy(Reflect.get(value, key), depth + 1));
    }
    active.delete(value);
    return result;
  }
  return copy(value, 0);
}

export function planLegacyPopulation(
  data: RecordValue,
  schema: readonly PayloadFieldSchema[],
  serverURL: string,
  apiRoute: string,
  depth: number,
  locale?: string,
): LegacyPlan {
  if (!Number.isSafeInteger(depth) || depth < 0 || depth > MAX_DEPTH) return fail();
  if (
    locale !== undefined &&
    (typeof locale !== 'string' || locale.length > 128 || hasControl(locale))
  ) {
    fail();
  }
  const doc = copyLegacyData(data);
  if (!isPlainObject(doc)) return fail();
  const groups = new Map<string, Slot[]>();
  const unique = new Set<string>();
  let nodes = 0;
  const active = new WeakSet();
  const tick = (level: number): void => {
    if (++nodes > MAX_NODES || level > MAX_DEPTH) fail();
  };

  function relation(
    owner: RecordValue | unknown[],
    key: string | number,
    collection: string,
    value: unknown,
  ): void {
    if (value === null || value === undefined || value === '') return;
    const selected = isPlainObject(value) ? own(value, 'id') : value;
    const identity = id(selected);
    if (depth === 0) {
      put(owner, key, selected);
      return;
    }
    const scope = JSON.stringify([collection, identity]);
    unique.add(scope);
    if (unique.size > MAX_IDS) fail();
    const slots = groups.get(collection) ?? [];
    slots.push({ owner, key, id: identity });
    groups.set(collection, slots);
  }
  function fieldRelation(
    owner: RecordValue | unknown[],
    key: string | number,
    field: PayloadFieldSchema,
  ): void {
    if (field.hasMany !== undefined && typeof field.hasMany !== 'boolean') fail();
    const allowed = field.relationTo;
    const value = own(owner, key);
    if (Array.isArray(allowed)) {
      if (allowed.length === 0) fail();
      const collection = isPlainObject(value) ? own(value, 'relationTo') : undefined;
      let selectedCollection: string | undefined;
      for (const candidate of allowed) {
        tick(0);
        if (!slug(candidate)) fail();
        if (candidate === collection) selectedCollection = candidate;
      }
      if (value === null || value === undefined || value === '') return;
      if (!isPlainObject(value) || selectedCollection === undefined) fail();
      relation(value, 'value', selectedCollection, own(value, 'value'));
    } else {
      if (!slug(allowed)) fail();
      relation(owner, key, allowed, value);
    }
  }
  function rich(value: unknown, level: number): void {
    tick(level);
    if (!Array.isArray(value) && !isPlainObject(value)) return;
    if (
      isPlainObject(value) &&
      Object.hasOwn(value, 'relationTo') &&
      Object.hasOwn(value, 'value')
    ) {
      const collection = own(value, 'relationTo');
      if (!slug(collection)) fail();
      relation(value, 'value', collection, own(value, 'value'));
      return;
    }
    for (const key of Object.keys(value)) rich(Reflect.get(value, key), level + 1);
  }
  function walk(fields: readonly PayloadFieldSchema[], record: RecordValue, level: number): void {
    tick(level);
    if (active.has(fields)) fail();
    active.add(fields);
    for (const field of fields) {
      tick(level);
      if (!isPlainObject(field) || !segment(field.name, 512) || FORBIDDEN.has(field.name)) fail();
      const value = own(record, field.name);
      if (field.type === 'relationship' || field.type === 'upload') {
        if (field.hasMany) {
          if (value !== null && value !== undefined && !Array.isArray(value)) fail();
          if (Array.isArray(value)) {
            for (let i = 0; i < value.length; i += 1) fieldRelation(value, i, field);
          } else fieldRelation(record, field.name, field);
        } else fieldRelation(record, field.name, field);
      } else if (field.type === 'group' || field.type === 'tabs') {
        if (value != null && !isPlainObject(value)) fail();
        if (isPlainObject(value) && field.fields) walk(field.fields, value, level + 1);
      } else if (field.type === 'row' || field.type === 'collapsible') {
        if (field.fields) walk(field.fields, record, level + 1);
      } else if (field.type === 'array' || field.type === 'blocks') {
        if (value === 0) put(record, field.name, []);
        else if (value != null && !Array.isArray(value)) fail();
        if (Array.isArray(value)) {
          for (const row of value) {
            if (!isPlainObject(row)) fail();
            if (field.type === 'array' && field.fields) walk(field.fields, row, level + 1);
            else if (field.type === 'blocks') {
              const blockType = own(row, 'blockType');
              const block = field.blocks?.find((candidate) => {
                tick(level);
                return candidate.slug === blockType;
              });
              if (block === undefined) fail();
              walk(block.fields, row, level + 1);
            }
          }
        }
      } else if (field.type === 'richText') rich(value, level + 1);
    }
    active.delete(fields);
  }
  walk(schema, doc, 0);
  if (groups.size > 25) fail();
  const requests: LegacyRequest[] = [];
  if (groups.size === 0) return { doc, requests };
  const base = new URL(serverURL);
  if (
    !['http:', 'https:'].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  ) {
    fail();
  }
  if (
    !apiRoute.startsWith('/') ||
    apiRoute.includes('\\') ||
    /[%?#]/u.test(apiRoute) ||
    hasControl(apiRoute)
  ) {
    fail();
  }
  if (apiRoute.split('/').some((part) => part === '.' || part === '..')) fail();
  const prefix = `${stripTrailingSlashes(serverURL)}${stripTrailingSlashes(apiRoute)}/`;
  for (const [collection, slots] of groups) {
    const identities = [...new Set(slots.map((slot) => slot.id))];
    let index = 0;
    while (index < identities.length) {
      const first = identities[index];
      if (first === undefined) fail();
      const comma = first.includes(',');
      const chunk: string[] = [];
      let url = '';
      while (index < identities.length && chunk.length < CHUNK) {
        const next = identities[index];
        if (next === undefined || (chunk.length > 0 && (comma || next.includes(',')))) break;
        const proposed = [...chunk, next];
        const query = new URLSearchParams({
          depth: String(depth),
          limit: String(proposed.length),
        });
        if (locale !== undefined) query.set('locale', locale);
        query.set(comma ? 'where[id][equals]' : 'where[id][in]', comma ? next : proposed.join(','));
        const candidate = `${prefix}${encodeURIComponent(collection)}?${query}`;
        if (candidate.length > MAX_URL) {
          if (chunk.length === 0) fail();
          break;
        }
        if (new URL(candidate).origin !== base.origin) fail();
        chunk.push(next);
        index += 1;
        url = candidate;
      }
      if (chunk.length === 0 || requests.length >= MAX_REQUESTS) fail();
      const ids = new Set(chunk);
      requests.push({
        url,
        ids,
        slots: slots.filter((slot) => ids.has(slot.id)),
      });
    }
  }
  return { doc, requests };
}

/** Native bodies stop at byte and chunk limits; injected json-only shims still get shape limits. */
export async function populationBody(
  response: Response,
  signal: AbortSignal,
  current: () => boolean,
): Promise<unknown> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let cancelled = false;
  let finished = false;
  const obsolete = Symbol();
  let interrupt: (() => void) | undefined;
  const interrupted = new Promise<typeof obsolete>((resolve) => {
    interrupt = () => {
      resolve(obsolete);
    };
  });
  const check = (): void => {
    if (!current() || signal.aborted) fail();
  };
  const cancel = (): void => {
    if (reader === undefined || cancelled) return;
    cancelled = true;
    try {
      void Promise.resolve(reader.cancel()).catch(() => {
        /* teardown remains authoritative */
      });
    } catch {
      /* teardown remains authoritative */
    }
  };
  const abort = (): void => {
    interrupt?.();
    cancel();
  };
  signal.addEventListener('abort', abort, { once: true });
  try {
    check();
    const body = response.body ?? null;
    check();
    if (body === null) {
      const json: () => Promise<unknown> = response.json.bind(response);
      check();
      const value: unknown = await Promise.race([
        Promise.resolve().then(() => {
          check();
          return json();
        }),
        interrupted,
      ]);
      check();
      if (value === obsolete) fail();
      return value;
    }
    const getReader: () => ReadableStreamDefaultReader<Uint8Array> = body.getReader.bind(body);
    check();
    const activeReader = getReader();
    reader = activeReader;
    check();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    let count = 0;
    for (;;) {
      const pending = Promise.resolve().then(() => {
        check();
        const read = activeReader.read.bind(activeReader);
        check();
        return read();
      });
      const result = await Promise.race([pending, interrupted]);
      check();
      if (result === obsolete) fail();
      if (result.done) break;
      bytes += result.value.byteLength;
      if (++count > MAX_CHUNKS || bytes > MAX_BODY) fail();
      chunks.push(result.value);
    }
    finished = true;
    const data = new Uint8Array(bytes);
    let position = 0;
    for (const chunk of chunks) {
      data.set(chunk, position);
      position += chunk.byteLength;
    }
    try {
      return JSON.parse(new TextDecoder().decode(data));
    } catch {
      return fail();
    }
  } finally {
    signal.removeEventListener('abort', abort);
    if (!finished) cancel();
    try {
      reader?.releaseLock();
    } catch {
      /* a hostile pending read cannot own cleanup */
    }
  }
}

export function fillLegacyPopulation(request: LegacyRequest, body: unknown): void {
  const safe = copyLegacyData(body);
  if (!isPlainObject(safe)) fail();
  const docs = own(safe, 'docs');
  if (!Array.isArray(docs) || docs.length > CHUNK) fail();
  const found = new Map<string, unknown>();
  for (const raw of docs) {
    if (!isPlainObject(raw)) fail();
    const identity = id(own(raw, 'id'));
    if (!request.ids.has(identity) || found.has(identity)) fail();
    found.set(identity, raw);
  }
  if (found.size !== request.ids.size) fail();
  for (const slot of request.slots) put(slot.owner, slot.key, found.get(slot.id));
}
