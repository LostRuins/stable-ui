/**
 * Session-scoped, byte-bounded cache of Blobs and object URLs.
 *
 * IndexedDB continues to store data URLs. Mounted media retain cache entries;
 * released entries remain available for reuse until the LRU exceeds its byte
 * budget. This keeps URLs stable for right-click/open-in-new-tab without
 * retaining every image visited during the session.
 */

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

function dataUrlToBlob(dataUrl: string): Blob {
    const sep = dataUrl.indexOf(";base64,");
    if (sep === -1) {
        throw new Error(`Not a base64 data URL: ${dataUrl.slice(0, 32)}...`);
    }
    const mime = dataUrl.slice("data:".length, sep);
    const binary = atob(dataUrl.slice(sep + ";base64,".length));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: mime });
}

/** Build if absent and return the stable URL for an output field. */
export function ensureUrl(id: number, field: BlobField, dataUrl: string): string {
    const key = keyOf(id, field);
    const existing = cache.get(key);
    if (existing) {
        existing.lastUsed = ++useCounter;
        return existing.url;
    }

    const blob = dataUrlToBlob(dataUrl);
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
export function retainUrl(id: number, field: BlobField, dataUrl: string): string {
    const result = ensureUrl(id, field, dataUrl);
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
