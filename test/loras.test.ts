import test from "node:test";
import assert from "node:assert/strict";
import { extractLorasFromPrompt } from "../src/utils/loras.ts";

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
