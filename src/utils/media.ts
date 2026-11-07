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
