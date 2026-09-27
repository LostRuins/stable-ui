/**
 * Session-scoped cache of Blobs and their object URLs, keyed by output `id`
 * and image field ("image" | "extra_avi" | "final_frame").
 *
 * IndexedDB rows keep storing data-URL strings (persistence is untouched);
 * this cache is the in-memory representation: each data-URL string is decoded
 * into a Blob at most once, after which the multi-MB string no longer needs to
 * live on the JS heap. The decoded bytes live in the browser's blob store
 * (off the V8 heap in Chrome).
 *
 * The cache is deliberately NOT reactive (no ref/reactive wrapping) and dies
 * with the tab. Object URLs are revoked ONLY by evict() — nowhere else — so
 * callers may keep a URL returned here for as long as the row exists.
 */

export type BlobField = "image" | "extra_avi" | "final_frame";

const BLOB_FIELDS: readonly BlobField[] = ["image", "extra_avi", "final_frame"];

interface CacheEntry {
    blob: Blob;
    url: string;
}

const cache = new Map<string, CacheEntry>();

const keyOf = (id: number, field: BlobField) => `${id}:${field}`;

/**
 * Decodes a base64 data-URL string into a Blob of the same type.
 * Synchronous, no canvas re-encoding (unlike convertBase64ToBlob, which may
 * detour through canvas when a contentType is passed).
 */
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

/**
 * Build if absent; always returns the stable blob: URL for (id, field).
 * The caller's dataUrl string is consumed, not stored; a second call for the
 * same (id, field) returns the first URL no matter what string is passed.
 */
export function ensureUrl(id: number, field: BlobField, dataUrl: string): string {
    const key = keyOf(id, field);
    const existing = cache.get(key);
    if (existing) return existing.url;

    const blob = dataUrlToBlob(dataUrl);
    const entry: CacheEntry = { blob, url: URL.createObjectURL(blob) };
    cache.set(key, entry);
    return entry.url;
}

/** Lookup without building. */
export function url(id: number, field: BlobField): string | null {
    return cache.get(keyOf(id, field))?.url ?? null;
}

/** Lookup the Blob without building. */
export function blob(id: number, field: BlobField): Blob | null {
    return cache.get(keyOf(id, field))?.blob ?? null;
}

/**
 * Revoke all URLs + drop all fields of one output id.
 * THE ONLY PLACE URLs get revoked (called on DB-row deletion).
 */
export function evict(id: number): void {
    for (const field of BLOB_FIELDS) {
        const key = keyOf(id, field);
        const entry = cache.get(key);
        if (entry) {
            URL.revokeObjectURL(entry.url);
            cache.delete(key);
        }
    }
}

/** Number of cached (id, field) entries. */
export function size(): number {
    return cache.size;
}
