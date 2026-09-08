import test from "node:test";
import assert from "node:assert/strict";
import { parseExtraRequestFields } from "../src/utils/extraRequestFields.ts";

test("empty extra request fields are a no-op", () => {
    assert.deepEqual(parseExtraRequestFields(""), {});
    assert.deepEqual(parseExtraRequestFields("  \n  "), {});
});

test("parses a JSON object with arbitrary fields", () => {
    assert.deepEqual(
        parseExtraRequestFields('{"foofoo":true,"barbar":232}'),
        { foofoo: true, barbar: 232 },
    );
});

test("parsed fields can overwrite generated request fields", () => {
    const request = { steps: 20, width: 512 };
    Object.assign(request, parseExtraRequestFields('{"steps":40,"custom":true}'));
    assert.deepEqual(request, { steps: 40, width: 512, custom: true });
});

test("rejects invalid JSON", () => {
    assert.throws(
        () => parseExtraRequestFields('{"foo":'),
        /must be valid JSON/,
    );
});

test("rejects JSON values that are not objects", () => {
    for (const value of ["null", "true", "123", '"text"', "[]"]) {
        assert.throws(
            () => parseExtraRequestFields(value),
            /must be a JSON object/,
        );
    }
});
