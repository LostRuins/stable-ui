import test from "node:test";
import assert from "node:assert/strict";
import { extractLorasFromPrompt, extractLoraRowsFromPrompt, allocateLoraRows } from "../src/utils/loras.ts";
import { parsePromptSegments } from "../src/utils/expansions.ts";

// extractLoraRowsFromPrompt takes the segments of parsePromptSegments(prompt)
const extractRows = (prompt: string) => extractLoraRowsFromPrompt(prompt, parsePromptSegments(prompt));

test("extracts tags and strips them from the prompt", () => {
    const [cleaned, data] = extractLorasFromPrompt("a <lora:x:0.5> b");
    assert.equal(cleaned, "a  b");
    assert.deepEqual(data, [{ name: "x", multiplier: 0.5 }]);
});

test("the |high_noise| prefix sets the flag and is stripped from the name", () => {
    const [, data] = extractLorasFromPrompt("a <lora:|high_noise|x:0.5> b");
    assert.deepEqual(data, [{ name: "x", multiplier: 0.5, is_high_noise: true }]);
});

test("duplicate tags are kept as separate entries", () => {
    const [, data] = extractLorasFromPrompt("<lora:x:0.6> <lora:x:0.3>");
    assert.deepEqual(data, [
        { name: "x", multiplier: 0.6 },
        { name: "x", multiplier: 0.3 },
    ]);
});

test("tags with a non-numeric or blank multiplier are stripped but not recorded", () => {
    const [cleaned1, data1] = extractLorasFromPrompt("a <lora:x:xyz> b");
    assert.equal(cleaned1, "a  b");
    assert.deepEqual(data1, []);

    const [cleaned2, data2] = extractLorasFromPrompt("a <lora:x:   > b");
    assert.equal(cleaned2, "a  b");
    assert.deepEqual(data2, []);
});

test("prompts without tags are returned unchanged", () => {
    const [cleaned, data] = extractLorasFromPrompt("just a prompt <with:colons> and stuff");
    assert.equal(cleaned, "just a prompt <with:colons> and stuff");
    assert.deepEqual(data, []);
});

test("extractLoraRowsFromPrompt converts a tag into a row and strips it from the prompt", () => {
    const [cleaned, rows] = extractRows("a <lora:x:0.5> b");
    assert.equal(cleaned, "a b");
    assert.deepEqual(rows, [{ name: "x", multiplier: 0.5 }]);
});

test("extractLoraRowsFromPrompt leaves tags in expansion options as-is", () => {
    const [cleaned, rows] = extractRows("{<lora:a:1>|<lora:b:2>} c <lora:c:0.3>");
    assert.equal(cleaned, "{<lora:a:1>|<lora:b:2>} c");
    assert.deepEqual(rows, [{ name: "c", multiplier: 0.3 }]);
});

test("extractLoraRowsFromPrompt leaves tags with an invalid weight as-is", () => {
    const [cleaned1, rows1] = extractRows("a <lora:x:xyz> b");
    assert.equal(cleaned1, "a <lora:x:xyz> b");
    assert.deepEqual(rows1, []);

    // an empty weight cannot match the tag syntax at all
    const [cleaned2, rows2] = extractRows("a <lora:x:> b");
    assert.equal(cleaned2, "a <lora:x:> b");
    assert.deepEqual(rows2, []);
});

test("extractLoraRowsFromPrompt leaves high-noise tags as-is", () => {
    const [cleaned, rows] = extractRows("a <lora:|high_noise|x:0.5> b <lora:y:0.2>");
    assert.equal(cleaned, "a <lora:|high_noise|x:0.5> b");
    assert.deepEqual(rows, [{ name: "y", multiplier: 0.2 }]);
});

test("extractLoraRowsFromPrompt leaves tags with an empty (whitespace) name as-is", () => {
    const [cleaned, rows] = extractRows("a <lora:   :0.5> b");
    assert.equal(cleaned, "a <lora:   :0.5> b");
    assert.deepEqual(rows, []);
});

test("extractLoraRowsFromPrompt converts zero-weight tags", () => {
    const [cleaned, rows] = extractRows("<lora:x:0>");
    assert.equal(cleaned, "");
    assert.deepEqual(rows, [{ name: "x", multiplier: 0 }]);
});

test("extractLoraRowsFromPrompt keeps duplicate tags as separate rows, in prompt order", () => {
    const [cleaned, rows] = extractRows("<lora:b:0.3> <lora:a:0.7> <lora:b:0.4>");
    assert.equal(cleaned, "");
    assert.deepEqual(rows, [
        { name: "b", multiplier: 0.3 },
        { name: "a", multiplier: 0.7 },
        { name: "b", multiplier: 0.4 },
    ]);
});

test("extractLoraRowsFromPrompt never scans the part after a ' ### ' separator", () => {
    const [cleaned, rows] = extractRows("a <lora:x:0.5> ### <lora:y:0.9> n");
    assert.equal(cleaned, "a ### <lora:y:0.9> n");
    assert.deepEqual(rows, [{ name: "x", multiplier: 0.5 }]);
});

test("extractLoraRowsFromPrompt returns the prompt unchanged when no tag is converted", () => {
    const prompt = "  a  b <lora:x:oops> c  ";
    const [cleaned, rows] = extractRows(prompt);
    assert.equal(cleaned, prompt);
    assert.deepEqual(rows, []);
});

test("allocateLoraRows overwrites the trailing empty rows first (oldest first)", () => {
    const result = allocateLoraRows(
        [
            { lora: "a", multiplier: 0 },
            { lora: "", multiplier: 0 },
            { lora: "", multiplier: 1 },
            { lora: "", multiplier: 0 },
            { lora: "", multiplier: 0 },
        ],
        [
            { lora: "x", multiplier: 0.5 },
            { lora: "y", multiplier: 0.25 },
            { lora: "z", multiplier: 0.75 },
        ],
    );
    assert.deepEqual(result, [
        { lora: "a", multiplier: 0 },
        { lora: "", multiplier: 0 },
        { lora: "", multiplier: 1 },
        { lora: "x", multiplier: 0.5 },
        { lora: "y", multiplier: 0.25 },
        { lora: "z", multiplier: 0.75 },
    ]);
});

test("allocateLoraRows appends new rows when there is no trailing empty space", () => {
    const result = allocateLoraRows(
        [{ lora: "a", multiplier: 1 }],
        [{ lora: "x", multiplier: 0.5 }],
    );
    assert.deepEqual(result, [
        { lora: "a", multiplier: 1 },
        { lora: "x", multiplier: 0.5 },
    ]);
});

test("allocateLoraRows does not reuse empty rows that are not trailing", () => {
    const result = allocateLoraRows(
        [{ lora: "", multiplier: 0 }, { lora: "a", multiplier: 1 }],
        [{ lora: "x", multiplier: 0.5 }],
    );
    assert.deepEqual(result, [
        { lora: "", multiplier: 0 },
        { lora: "a", multiplier: 1 },
        { lora: "x", multiplier: 0.5 },
    ]);
});

test("allocateLoraRows uses only as many empty rows as there are incoming rows", () => {
    const result = allocateLoraRows(
        [{ lora: "a", multiplier: 1 }, { lora: "", multiplier: 0 }, { lora: "", multiplier: 0 }],
        [{ lora: "x", multiplier: 0.5 }],
    );
    assert.deepEqual(result, [
        { lora: "a", multiplier: 1 },
        { lora: "x", multiplier: 0.5 },
        { lora: "", multiplier: 0 },
    ]);
});

test("allocateLoraRows returns a new array without mutating the input", () => {
    const input = [{ lora: "", multiplier: 0 }];
    const result = allocateLoraRows(input, [{ lora: "x", multiplier: 0.5 }]);
    assert.notEqual(result, input);
    assert.deepEqual(input, [{ lora: "", multiplier: 0 }]);
    assert.deepEqual(result, [{ lora: "x", multiplier: 0.5 }]);
});
