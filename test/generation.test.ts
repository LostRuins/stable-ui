import test from "node:test";
import assert from "node:assert/strict";
import { batchShouldFinalize, type IQueuedGeneration } from "../src/utils/generation.ts";

const item = (gathered: boolean, failed: boolean): IQueuedGeneration => ({ gathered, failed });

test("a cancelled batch finalizes even with pending items", () => {
    // The reported bug: cancelling a batch after some images were collected
    // left the batch unfinalized (no failed items, pending items abandoned),
    // so the collected outputs were never shown.
    assert.equal(batchShouldFinalize(true, [item(true, false), item(false, false)]), true);
    assert.equal(batchShouldFinalize(true, [item(false, false)]), true);
    assert.equal(batchShouldFinalize(true, []), true);
});

test("an all-success batch does not finalize here (processImages does)", () => {
    assert.equal(batchShouldFinalize(false, [item(true, false), item(true, false)]), false);
});

test("a batch with failures finalizes only once every item is done", () => {
    assert.equal(batchShouldFinalize(false, [item(true, true), item(false, false)]), false);
    assert.equal(batchShouldFinalize(false, [item(true, true), item(true, false)]), true);
    assert.equal(batchShouldFinalize(false, [item(true, true)]), true);
});

test("an empty, uncancelled batch does not finalize", () => {
    assert.equal(batchShouldFinalize(false, []), false);
});
