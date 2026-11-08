/**
 * A byte-bounded LRU of Blobs and object URLs, keyed by opaque strings.
 *
 * Entries are reference-counted: `retain` marks an entry as actively
 * rendered, `release` unmarks it. `trim` revokes least-recently-used
 * *inactive* entries until the total size fits the budget; active entries
 * are never revoked, so mounted media may temporarily exceed the budget.
 * `release` bumps the entry's last-use position, so a just-released entry is
 * the last one trimmed.
 *
 * Deliberately free of any other src imports (and of any app concepts), so
 * Node's type-stripping test runner can load it directly. The app-facing
 * layer over this core is `blobCache.ts`.
 */

export interface BlobLru {
    /**
     * Build the entry if absent — calling `make` exactly once, on a miss —
     * and return its stable object URL. A hit just refreshes the entry's
     * last-use position.
     */
    create(key: string, make: () => Blob): string;
    /** Mark an entry as actively rendered. Returns false if not cached. */
    retain(key: string): boolean;
    /** Release one renderer; the entry remains in the warm LRU. */
    release(key: string): void;
    /** The entry's object URL, or null if not cached. */
    urlOf(key: string): string | null;
    /** The entry's Blob, or null if not cached. */
    blobOf(key: string): Blob | null;
    /** Force-drop specific entries (regardless of active users), revoking their URLs. */
    evictKeys(keys: Iterable<string>): void;
    /** Revoke least-recently-used inactive entries until the total size fits `maxBytes`. */
    trim(maxBytes: number): void;
    /** Number of cached entries. */
    size(): number;
}

interface LruEntry {
    blob: Blob;
    url: string;
    users: number;
    lastUsed: number;
}

export function createBlobLru(): BlobLru {
    const cache = new Map<string, LruEntry>();
    let cacheBytes = 0;
    let useCounter = 0;

    const create = (key: string, make: () => Blob): string => {
        const existing = cache.get(key);
        if (existing) {
            existing.lastUsed = ++useCounter;
            return existing.url;
        }
        const blob = make();
        const entry: LruEntry = { blob, url: URL.createObjectURL(blob), users: 0, lastUsed: ++useCounter };
        cache.set(key, entry);
        cacheBytes += blob.size;
        return entry.url;
    };

    const retain = (key: string): boolean => {
        const entry = cache.get(key);
        if (!entry) return false;
        entry.users++;
        entry.lastUsed = ++useCounter;
        return true;
    };

    const release = (key: string): void => {
        const entry = cache.get(key);
        if (!entry) return;
        entry.users = Math.max(0, entry.users - 1);
        entry.lastUsed = ++useCounter;
    };

    const urlOf = (key: string): string | null => cache.get(key)?.url ?? null;
    const blobOf = (key: string): Blob | null => cache.get(key)?.blob ?? null;

    const evictKeys = (keys: Iterable<string>): void => {
        for (const key of keys) {
            const entry = cache.get(key);
            if (!entry) continue;
            URL.revokeObjectURL(entry.url);
            cache.delete(key);
            cacheBytes -= entry.blob.size;
        }
    };

    const trim = (maxBytes: number): void => {
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
    };

    const size = (): number => cache.size;

    return { create, retain, release, urlOf, blobOf, evictKeys, trim, size };
}
