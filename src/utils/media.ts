import type { OutputImageFormat } from "@/stores/outputs";

/**
 * Stored-prompt helpers.
 *
 * A row stores its prompt as two fields: `prompt` (the positive prompt, with
 * any `<lora:>` tags) and `negative_prompt`. Rows written before the split
 * carry both parts concatenated as `"{positive} ### {negative}"` in `prompt`
 * alone; they stay readable through `getPromptParts`, which falls back to
 * `splitStoredPrompt`. The ` ### ` join is a storage/serialization detail —
 * no other code layer parses it (the generation screen's typed prompt and
 * the share-link payload are the only other users of the separator).
 */

/**
 * Splits a stored prompt at the first ` ### ` separator.
 *
 * Mirrors the legacy `prompt.split(" ### ")[0/1]` semantics exactly: only
 * the first separator is significant, and the remainder — including any
 * further ` ### ` — goes into `negative_prompt` verbatim. No separator
 * yields an empty `negative_prompt`; `undefined` is treated as `""`.
 */
export function splitStoredPrompt(prompt: string | undefined): { prompt: string; negative_prompt: string } {
    const stored = prompt ?? "";
    const separatorIndex = stored.indexOf(" ### ");
    if (separatorIndex === -1) return { prompt: stored, negative_prompt: "" };
    return {
        prompt: stored.slice(0, separatorIndex),
        negative_prompt: stored.slice(separatorIndex + " ### ".length),
    };
}

/**
 * The (positive, negative) pair of a stored row, in the single form every
 * read-side consumer wants. Rows with a `negative_prompt` field (written
 * after the split) are used as-is; rows without one (legacy concatenated
 * rows, hand-built rows, share-link restores) fall back to
 * `splitStoredPrompt`.
 */
export function getPromptParts(row: { prompt?: string; negative_prompt?: string }): { prompt: string; negative_prompt: string } {
    if (row.negative_prompt !== undefined) {
        return { prompt: row.prompt ?? "", negative_prompt: row.negative_prompt };
    }
    return splitStoredPrompt(row.prompt);
}

/**
 * The inverse of `splitStoredPrompt` — joins the two fields into the
 * legacy concatenated form. Used at the one serialization boundary that
 * carries the joined form: the share-link payload (so old and new links
 * are identical).
 */
export function joinPrompts(prompt: string, negative_prompt: string): string {
    return negative_prompt === "" ? prompt : `${prompt} ### ${negative_prompt}`;
}

/**
 * Media field helpers.
 *
 * The three media fields of a row (`image`, `extra_avi`, `final_frame`) are
 * stored as data-URL `string`s on legacy rows and as native `Blob`s on rows
 * written after the move to blob storage. The helpers below are the single
 * conversion points: `toMediaBlob` normalizes a stored value to a `Blob` for
 * reading, and `mediaToDataUrl`/`blobToDataUrl` produce data URLs only at the
 * boundaries that genuinely need them (share links, ZIP sidecars, canvas /
 * `init_images`).
 */

export type MediaField = string | Blob;

/** Decodes a raw base64 string into a Blob of the given mime type. */
export function base64ToBlob(b64: string, mime: string): Blob {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: mime });
}

/** Decodes a base64 data URL into a Blob, taking the mime type from the URL. */
export function dataUrlToBlob(dataUrl: string): Blob {
    const sep = dataUrl.indexOf(";base64,");
    if (sep === -1) {
        throw new Error(`Not a base64 data URL: ${dataUrl.slice(0, 32)}...`);
    }
    const mime = dataUrl.slice("data:".length, sep);
    return base64ToBlob(dataUrl.slice(sep + ";base64,".length), mime);
}

/**
 * Encodes a Blob as a data-URL string (the boundary representation).
 * `arrayBuffer` + `btoa` cover both the browser and Node (no FileReader),
 * chunked to avoid stack overflow on multi-MB media.
 */
export function blobToDataUrl(blob: Blob): Promise<string> {
    return blob.arrayBuffer().then(buffer => {
        const bytes = new Uint8Array(buffer);
        let binary = "";
        const chunkSize = 0x8000;
        for (let i = 0; i < bytes.length; i += chunkSize) {
            binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
        }
        return `data:${blob.type};base64,${btoa(binary)}`;
    });
}

/**
 * The single read-side normalizer for a stored media field: absent
 * (`null`/`""`) → `undefined`, a `Blob` passes through, a legacy data-URL
 * string is decoded.
 */
export function toMediaBlob(value: MediaField | null | undefined): Blob | undefined {
    if (value == null || value === "") return undefined;
    if (value instanceof Blob) return value;
    return dataUrlToBlob(value);
}

/**
 * The boundary producer for the consumers that need a data-URL string
 * (share links, ZIP sidecars, canvas / `init_images`): legacy strings pass
 * through verbatim, `Blob`s are encoded, absent → `""`.
 */
export function mediaToDataUrl(value: MediaField | null | undefined): Promise<string> {
    if (value == null || value === "") return Promise.resolve("");
    if (value instanceof Blob) return blobToDataUrl(value);
    return Promise.resolve(value);
}

/** The image format of a stored media value (both value types). */
export function mediaFormat(value: MediaField | null | undefined): OutputImageFormat {
    if (value == null || value === "") return "unknown";
    const match = value instanceof Blob
        ? /^image\/(gif|webp|png|jpe?g)$/i.exec(value.type)
        : /^data:image\/(gif|webp|png|jpe?g)(?:;|,)/i.exec(value);
    if (!match) return "unknown";
    const format = match[1].toLowerCase();
    return format === "jpg" ? "jpeg" : format as OutputImageFormat;
}
