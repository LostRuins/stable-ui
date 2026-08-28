import test from "node:test";
import assert from "node:assert/strict";
import { parsePromptSegments, expandPromptSegments } from "../src/utils/expansions.ts";

test("parsePromptSegments produces the segment list (X) for the sample", () => {
    const segments = parsePromptSegments("ppp{111|222}qqq");
    assert.deepEqual(
        segments.map(s => s.type === "literal" ? { type: s.type, text: s.text } : { type: s.type, options: s.options }),
        [
            { type: "literal", text: "ppp" },
            { type: "expansion", options: ["111", "222"] },
            { type: "literal", text: "qqq" },
        ],
    );
});

test("segments tile the whole prompt with ordered offsets", () => {
    const segments = parsePromptSegments("ppp{111|222}qqq");
    assert.deepEqual(segments.map(s => [s.start, s.end]), [[0, 3], [3, 12], [12, 15]]);
    assert.ok(segments.every((s, i) => i === 0 || segments[i - 1].end === s.start));
    assert.equal(segments[segments.length - 1].end, 15);
});

test("expandPromptSegments expands the sample", () => {
    assert.deepEqual(
        expandPromptSegments(parsePromptSegments("ppp{111|222}qqq")),
        ["ppp111qqq", "ppp222qqq"],
    );
});

test("prompts without braces expand to themselves", () => {
    assert.deepEqual(expandPromptSegments(parsePromptSegments("")), [""]);
    assert.deepEqual(expandPromptSegments(parsePromptSegments("abc")), ["abc"]);
});

test("basic and multi-expansion results", () => {
    const expand = (prompt: string) => expandPromptSegments(parsePromptSegments(prompt));
    assert.deepEqual(expand("a{b|c}d"), ["abd", "acd"]);
    assert.deepEqual(expand("{a|b}c{d|e}f"), ["acdf", "acef", "bcdf", "bcef"]);
    assert.deepEqual(expand("{a|b|c}"), ["a", "b", "c"]);
});

test("repeated identical expansions expand both occurrences", () => {
    const expand = (prompt: string) => expandPromptSegments(parsePromptSegments(prompt));
    assert.deepEqual(expand("{a|b}x{a|b}"), ["axa", "axb", "bxa", "bxb"]);
    assert.deepEqual(expand("{a|b}c{a|b}"), ["aca", "acb", "bca", "bcb"]);
});

test("edge-case expansions", () => {
    const expand = (prompt: string) => expandPromptSegments(parsePromptSegments(prompt));
    assert.deepEqual(expand("{}"), [""]);
    assert.deepEqual(expand("{a|}b"), ["ab", "b"]);
    assert.deepEqual(expand("{|a}b"), ["b", "ab"]);
    assert.deepEqual(expand("{x}y"), ["xy"]);
});

test("an unclosed brace (and the rest of the prompt) is literal", () => {
    assert.deepEqual(expandPromptSegments(parsePromptSegments("a{b|c")), ["a{b|c"]);
});

test("a stray closing brace is literal", () => {
    assert.deepEqual(expandPromptSegments(parsePromptSegments("a}b")), ["a}b"]);
});

test("nested braces keep the historical (first-`}`-closes) semantics", () => {
    const expand = (prompt: string) => expandPromptSegments(parsePromptSegments(prompt));
    assert.deepEqual(expand("x{a|{b|c}}y"), ["xa}y", "x{b}y", "xc}y"]);
    assert.deepEqual(expand("{a|b{c|d}}e{c|d}f"), ["a}ecf", "a}edf", "b{c}ecf", "b{c}edf", "d}ecf", "d}edf"]);
});

test("options containing String.replace patterns are used verbatim", () => {
    const expand = (prompt: string) => expandPromptSegments(parsePromptSegments(prompt));
    assert.deepEqual(expand("{a|$&|b}x"), ["ax", "$&x", "bx"]);
    assert.deepEqual(expand("{hi|a$'b}!"), ["hi!", "a$'b!"]);
});

test("tags in literal segments map 1:1 onto the original prompt", () => {
    const prompt = "a{l|m} <lora:x:0.5> {c|d} <lora:y:1>";
    const segments = parsePromptSegments(prompt);
    assert.deepEqual(segments.map(s => s.type), ["literal", "expansion", "literal", "expansion", "literal"]);

    const tagPattern = /<lora:([^:>]+):([^>]+)>/g;
    const found: { name: string; weight: string; origStart: number; origEnd: number }[] = [];
    for (const segment of segments) {
        if (segment.type !== "literal") continue;
        for (const match of segment.text.matchAll(tagPattern)) {
            found.push({
                name: match[1],
                weight: match[2],
                origStart: segment.start + match.index,
                origEnd: segment.start + match.index + match[0].length,
            });
        }
    }
    assert.deepEqual(found, [
        { name: "x", weight: "0.5", origStart: 7, origEnd: 19 },
        { name: "y", weight: "1", origStart: 26, origEnd: 36 },
    ]);
    for (const f of found) {
        assert.ok(prompt.slice(f.origStart, f.origEnd).startsWith("<lora:"));
    }
});
