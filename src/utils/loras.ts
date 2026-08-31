import type { PromptSegment } from "./expansions";

export interface ILoraData {
  name: string;
  multiplier: number;
  is_high_noise?: boolean;
}

/**
 * Extracts LoRA information from a prompt.
 * @param prompt The input prompt string.
 * @returns An array containing the modified prompt and the extracted LoRA data.
 */
export function extractLorasFromPrompt(prompt: string): [string, ILoraData[]] {
  const loraData: ILoraData[] = [];
  const pattern = /<lora:([^:>]+):([^>]+)>/g;

  const updatedPrompt = prompt.replace(pattern, (match, rawPath, rawMul) => {
    if (rawMul.trim() === "") {
      return "";
    }
    const mul = Number(rawMul);

    if (isNaN(mul)) {
      return "";
    }

    let path = rawPath;
    let isHighNoise = false;
    const prefix = "|high_noise|";
    if (path.startsWith(prefix)) {
      path = path.substring(prefix.length);
      isHighNoise = true;
    }

    loraData.push({
      name: path,
      multiplier: mul,
      ...(isHighNoise ? { is_high_noise: true } : {}),
    });

    return "";
  });

  return [updatedPrompt, loraData];
}

/**
 * An entry extracted from a prompt's <lora:> tag, ready to be turned into a
 * row of the generation screen's (non-persisted) LoRA list
 */
export interface ILoraRowEntry {
  /** The tag's name (the tag text after `<lora:`, without the `|high_noise|` prefix) */
  name: string;
  /** The tag's weight, parsed as a number */
  multiplier: number;
}

/**
 * A row of the generation screen's (non-persisted) LoRA list, as far as the
 * row allocation is concerned
 */
export interface ILoraRow {
  /** The selected LoRA (the `path` from GET /sdapi/v1/loras, or a tag name that need not resolve to one) */
  lora: string;
  /** LoRA multiplier */
  multiplier: number;
}

/**
 * Extracts the LoRA tags of a prompt that can be turned into rows of the
 * generation screen's (non-persisted) LoRA list — the inverse of what the
 * screen's "To Prompt" button appends.
 *
 * Only the part of the prompt before the first `" ### "` separator is scanned
 * (the remainder is never scanned for LoRA tags). A tag is converted only
 * when all of these hold:
 * - it is contained in a *literal* segment (tags inside `{a|b}` expansion
 *   options would be altered by the expansion, so they stay in the prompt);
 * - its weight is valid (parses as a number; an empty weight cannot match
 *   the tag syntax at all);
 * - it is not high noise (the `|high_noise|` prefix);
 * - its name is not empty (a whitespace-only name counts as empty).
 * The tag's name need not match a LoRA from the server's list.
 *
 * @param prompt The prompt (as in the generation screen's prompt field,
 *               which may carry a `" ### "` separator).
 * @param segments The segments of `parsePromptSegments(prompt)` (type-only
 *                 import — this module stays runtime-independent from
 *                 `./expansions`, so the framework-free Node test runner
 *                 can load it).
 * @returns [The prompt with the converted tags removed — space runs
 *           collapsed and trimmed, the `" ### "` remainder preserved — and
 *           the entries in the tags' prompt order]. The prompt is returned
 *           unchanged when no tag is converted.
 */
export function extractLoraRowsFromPrompt(prompt: string, segments: PromptSegment[]): [string, ILoraRowEntry[]] {
  const separatorIndex = prompt.indexOf(" ### ");
  const positive = separatorIndex === -1 ? prompt : prompt.slice(0, separatorIndex);
  const rest = separatorIndex === -1 ? "" : prompt.slice(separatorIndex);

  const pattern = /<lora:([^:>]+):([^>]+)>/g;
  const prefix = "|high_noise|";
  const tags: { name: string; multiplier: number; start: number; end: number }[] = [];
  for (const segment of segments) {
    if (segment.type !== "literal") continue;
    if (segment.start >= positive.length) break; // the segments tile the whole prompt
    for (const match of segment.text.matchAll(pattern)) {
      const tagIndex = match.index;
      if (tagIndex === undefined) continue; // the type is optional, matchAll always sets it
      const start = segment.start + tagIndex;
      if (start >= positive.length) continue; // the tag starts in the unscanned remainder
      const weight = Number(match[2]);
      if (isNaN(weight)) continue; // invalid weight: keep the tag
      const name = match[1];
      if (name.startsWith(prefix)) continue; // high-noise tags are kept
      if (name.trim() === "") continue; // empty name: keep the tag
      tags.push({
        name,
        multiplier: weight,
        start,
        end: Math.min(start + match[0].length, positive.length),
      });
    }
  }

  if (tags.length === 0) return [prompt, []];

  // remove the converted tags (last first, so the earlier offsets stay valid),
  // collapse the space runs left behind, and trim — the `" ### "` remainder
  // is preserved as-is
  let cleaned = positive;
  for (let i = tags.length - 1; i >= 0; i--) {
    cleaned = cleaned.slice(0, tags[i].start) + cleaned.slice(tags[i].end);
  }
  return [
    cleaned.replace(/ +/g, " ").trim() + rest,
    tags.map(tag => ({ name: tag.name, multiplier: tag.multiplier })),
  ];
}

/**
 * Adds the given rows to the generation screen's (non-persisted) LoRA row
 * list, reusing the trailing rows that are still empty (no selection and
 * multiplier `0`) first — oldest first — and only appending new rows once
 * that available space is used up. All other rows are left untouched.
 *
 * @param rows The current row list.
 * @param incoming The rows to add.
 * @returns A new row list (the input rows are shallow-copied, not mutated).
 */
export function allocateLoraRows(rows: ILoraRow[], incoming: ILoraRow[]): ILoraRow[] {
  const result: ILoraRow[] = rows.map(row => ({ ...row }));
  let firstTrailingEmpty = result.length;
  while (
    firstTrailingEmpty > 0
    && result[firstTrailingEmpty - 1].lora === ""
    && result[firstTrailingEmpty - 1].multiplier === 0
  ) {
    firstTrailingEmpty--;
  }
  incoming.forEach((entry, i) => {
    const index = firstTrailingEmpty + i;
    if (index < result.length) {
      result[index] = { lora: entry.lora, multiplier: entry.multiplier };
    } else {
      result.push({ lora: entry.lora, multiplier: entry.multiplier });
    }
  });
  return result;
}
