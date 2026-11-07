/**
 * Session-scoped, byte-bounded cache of Blobs and object URLs.
 *
 * IndexedDB stores media as data-URL strings (legacy rows) or native
 * Blobs (new rows); both arrive through `MediaField`. Mounted media retain
 * cache entries; released entries remain available for reuse until the LRU
 * exceeds its byte budget. This keeps URLs stable for right-click/open-in-
 * new-tab without retaining every image visited during the session.
 */

import { dataUrlToBlob, type MediaField } from "./media";

export type BlobField = "image" | "extra_avi" | "final_frame";

const BLOB_FIELDS: readonly BlobField[] = ["image", "extra_avi", "final_frame"];
const DEFAULT_MAX_BYTES = 512 * 1024 * 1024;

interface CacheEntry {
    blob: Blob;
    url: string;
    users: number;
    lastUsed: number;
}

const cache = new Map<string, CacheEntry>();
let cacheBytes = 0;
let useCounter = 0;

const keyOf = (id: number, field: BlobField) => `${id}:${field}`;

/** Build if absent and return the stable URL for an output field. */
export function ensureUrl(id: number, field: BlobField, value: MediaField): string {
    const key = keyOf(id, field);
    const existing = cache.get(key);
    if (existing) {
        existing.lastUsed = ++useCounter;
        return existing.url;
    }

    // Legacy rows carry a data-URL string (decode it); new rows carry the
    // native Blob (use it as-is, skipping the decode)
    const blob = typeof value === "string" ? dataUrlToBlob(value) : value;
    const entry: CacheEntry = {
        blob,
        url: URL.createObjectURL(blob),
        users: 0,
        lastUsed: ++useCounter,
    };
    cache.set(key, entry);
    cacheBytes += blob.size;
    return entry.url;
}

/** Build (if needed) and mark an object URL as actively rendered. */
export function retainUrl(id: number, field: BlobField, value: MediaField): string {
    const result = ensureUrl(id, field, value);
    const entry = cache.get(keyOf(id, field));
    if (entry) entry.users++;
    trim();
    return result;
}

/** Retain a cache hit without loading the original data URL from IndexedDB. */
export function retainCachedUrl(id: number, field: BlobField): string | null {
    const entry = cache.get(keyOf(id, field));
    if (!entry) return null;
    entry.users++;
    entry.lastUsed = ++useCounter;
    trim();
    return entry.url;
}

/** Release one renderer. The inactive entry remains in the warm LRU. */
export function releaseUrl(id: number, field: BlobField): void {
    const entry = cache.get(keyOf(id, field));
    if (!entry) return;
    entry.users = Math.max(0, entry.users - 1);
    entry.lastUsed = ++useCounter;
    trim();
}

/** Lookup without building. */
export function url(id: number, field: BlobField): string | null {
    return cache.get(keyOf(id, field))?.url ?? null;
}

/** Lookup the Blob without building. */
export function blob(id: number, field: BlobField): Blob | null {
    return cache.get(keyOf(id, field))?.blob ?? null;
}

/** Force removal of all cached fields for a deleted database row. */
export function evict(id: number): void {
    for (const field of BLOB_FIELDS) {
        const key = keyOf(id, field);
        const entry = cache.get(key);
        if (!entry) continue;
        URL.revokeObjectURL(entry.url);
        cache.delete(key);
        cacheBytes -= entry.blob.size;
    }
}

/**
 * Revoke least-recently-used inactive URLs until the cache fits the budget.
 * Active entries are never revoked, so mounted media can temporarily exceed it.
 */
export function trim(maxBytes = DEFAULT_MAX_BYTES): void {
    if (cacheBytes <= maxBytes) return;

    const inactive = [...cache.entries()]
        .filter(([, entry]) => entry.users === 0)
        .sort((a, b) => a[1].lastUsed - b[1].lastUsed);

    for (const [key, entry] of inactive) {
        if (cacheBytes <= maxBytes) break;
        URL.revokeObjectURL(entry.url);
        cache.delete(key);
        cacheBytes -= entry.blob.size;
    }
}

/** Number of cached output fields. */
export function size(): number {
    return cache.size;
}
