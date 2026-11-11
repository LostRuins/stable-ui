/**
 * Session-scoped, byte-bounded cache of Blobs and object URLs for the three
 * media fields of a stored output row.
 *
 * Thin app layer over the import-free LRU core in `blobCacheCore.ts`: it
 * maps (output id, field) pairs to opaque keys and decodes legacy data-URL
 * rows before handing Blobs to the LRU. IndexedDB stores media as data-URL
 * strings (legacy rows) or native Blobs (new rows); both arrive through
 * `MediaField`. Mounted media retain cache entries; released entries remain
 * available for reuse until the LRU exceeds its byte budget. This keeps URLs
 * stable for right-click/open-in-new-tab without retaining every image
 * visited during the session.
 */

import { createBlobLru } from "./blobCacheCore";
import { dataUrlToBlob, type MediaField } from "./media";

export type BlobField = "image" | "extra_avi" | "final_frame";

const BLOB_FIELDS: readonly BlobField[] = ["image", "extra_avi", "final_frame"];
const DEFAULT_MAX_BYTES = 512 * 1024 * 1024;

const lru = createBlobLru();
const keyOf = (id: number, field: BlobField) => `${id}:${field}`;

/** Build if absent and return the stable URL for an output field. */
export function ensureUrl(id: number, field: BlobField, value: MediaField): string {
    const key = keyOf(id, field);
    // Legacy rows carry a data-URL string (decode it); new rows carry the
    // native Blob (use it as-is, skipping the decode). The decoder runs only
    // on a cache miss.
    return lru.create(key, () => (typeof value === "string" ? dataUrlToBlob(value) : value));
}

/** Build (if needed) and mark an object URL as actively rendered. */
export function retainUrl(id: number, field: BlobField, value: MediaField): string {
    const result = ensureUrl(id, field, value);
    lru.retain(keyOf(id, field));
    trim();
    return result;
}

/** Retain a cache hit without loading the original data URL from IndexedDB. */
export function retainCachedUrl(id: number, field: BlobField): string | null {
    if (!lru.retain(keyOf(id, field))) return null;
    trim();
    return lru.urlOf(keyOf(id, field));
}

/** Release one renderer. The inactive entry remains in the warm LRU. */
export function releaseUrl(id: number, field: BlobField): void {
    lru.release(keyOf(id, field));
    trim();
}

/** Lookup without building. */
export function url(id: number, field: BlobField): string | null {
    return lru.urlOf(keyOf(id, field));
}

/** Lookup the Blob without building. */
export function blob(id: number, field: BlobField): Blob | null {
    return lru.blobOf(keyOf(id, field));
}

/** Force removal of all cached fields for a deleted database row. */
export function evict(id: number): void {
    lru.evictKeys(BLOB_FIELDS.map(field => keyOf(id, field)));
}

/**
 * Revoke least-recently-used inactive URLs until the cache fits the budget.
 * Active entries are never revoked, so mounted media can temporarily exceed it.
 */
export function trim(maxBytes = DEFAULT_MAX_BYTES): void {
    lru.trim(maxBytes);
}

/** Number of cached output fields. */
export function size(): number {
    return lru.size();
}
