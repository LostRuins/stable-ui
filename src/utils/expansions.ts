/**
 * Prompt expansion (the `{a|b}` matrix syntax), split into two phases:
 * 1. `parsePromptSegments`: the raw prompt is mapped to a list of segments —
 *    literal text, or an expansion (a list of alternative strings), each
 *    carrying its `[start, end)` range in the original prompt.
 * 2. `expandPromptSegments`: the segments are expanded into the full list of
 *    prompts (Cartesian product of the segment alternatives, concatenated).
 *
 * The segment list is the shared structure for anything that must distinguish
 * literal text from to-be-expanded text (e.g. extracting LoRA tags only from
 * literal segments, at positions in the original prompt).
 */
export type PromptSegment =
    | { type: "literal"; text: string; start: number; end: number }
    | { type: "expansion"; options: string[]; start: number; end: number };

/**
 * Splits a prompt into literal and expansion segments.
 *
 * - a `{...}` expansion ends at the *first* `}` (no nesting support — this
 *   mirrors the historical `/\{(.*?)\}/g` behavior; a nested `{` is just
 *   part of an option's text);
 * - a `{` with no closing `}` is literal, along with everything after it;
 * - a stray `}` is literal.
 *
 * @param prompt The raw prompt string.
 * @returns The list of segments, in order, covering the whole prompt.
 */
export function parsePromptSegments(prompt: string): PromptSegment[] {
    const segments: PromptSegment[] = [];
    let literalStart = 0;
    for (let i = 0; i < prompt.length; i++) {
        if (prompt[i] !== "{") continue;
        if (i > literalStart) {
            segments.push({ type: "literal", text: prompt.slice(literalStart, i), start: literalStart, end: i });
        }
        const end = prompt.indexOf("}", i + 1);
        if (end === -1) {
            // unclosed brace: the brace (and the rest of the prompt) is literal
            segments.push({ type: "literal", text: prompt.slice(i), start: i, end: prompt.length });
            literalStart = prompt.length;
            break;
        }
        segments.push({ type: "expansion", options: prompt.slice(i + 1, end).split("|"), start: i, end: end + 1 });
        literalStart = end + 1;
        i = end; // the loop increment moves past the closing '}'
    }
    if (literalStart < prompt.length) {
        segments.push({ type: "literal", text: prompt.slice(literalStart), start: literalStart, end: prompt.length });
    }
    return segments;
}

/**
 * Expands a list of segments into all the resulting prompts (Cartesian
 * product of the segment alternatives, concatenated). A literal segment
 * contributes its text as a single alternative.
 *
 * @param segments The segments of a parsed prompt.
 * @returns All the expanded prompts (a list with one entry for prompts
 *          without any expansion).
 */
export function expandPromptSegments(segments: PromptSegment[]): string[] {
    return segments.reduce<string[][]>(
        (acc, segment) => {
            const alternatives = segment.type === "literal" ? [segment.text] : segment.options;
            return acc.flatMap(prev => alternatives.map(option => [...prev, option]));
        },
        [[]]
    ).map(parts => parts.join(""));
}
