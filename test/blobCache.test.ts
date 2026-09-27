import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { ensureUrl, url, blob, evict, size } from "../src/utils/blobCache.ts";

// The cache is a module-level singleton shared by all tests in this file,
// so every test uses fresh ids and cleans up with evict().
//
// Node (v22.18+, dev/test on v26.8.2) provides URL.createObjectURL /
// URL.revokeObjectURL; we wrap them to count creations and record
// revocations (the plan's "minimal fake" is only needed on a Node lacking
// them).
const created: string[] = [];
const revoked: string[] = [];
const realCreate = URL.createObjectURL;
const realRevoke = URL.revokeObjectURL;

before(() => {
    URL.createObjectURL = (input: Blob) => {
        const u = realCreate(input);
        created.push(u);
        return u;
    };
    URL.revokeObjectURL = (u: string) => {
        revoked.push(u);
        realRevoke(u);
    };
});

after(() => {
    URL.createObjectURL = realCreate;
    URL.revokeObjectURL = realRevoke;
});

const payload = "hello blob";
const pngUrl = `data:image/png;base64,${Buffer.from(payload).toString("base64")}`;
const aviUrl = `data:video/avi;base64,${Buffer.from("avi bytes").toString("base64")}`;
const jpegUrl = `data:image/jpeg;base64,${Buffer.from("jpeg bytes").toString("base64")}`;

test("ensureUrl decodes the data URL into a same-type blob and returns a blob: URL", async () => {
    const id = 1001;
    const u = ensureUrl(id, "image", pngUrl);

    assert.match(u, /^blob:/);
    assert.equal(url(id, "image"), u);

    const b = blob(id, "image");
    assert.ok(b instanceof Blob);
    assert.equal(b.type, "image/png");
    assert.equal(Buffer.from(await b.arrayBuffer()).toString("utf8"), payload);

    evict(id);
});

test("ensureUrl builds at most once per (id, field); the first string wins", async () => {
    const id = 1002;
    const u1 = ensureUrl(id, "image", pngUrl);
    const creationsBefore = created.length;

    // A different payload for the same key must not trigger a rebuild.
    const u2 = ensureUrl(id, "image", aviUrl);
    assert.equal(u2, u1);
    assert.equal(created.length, creationsBefore);

    const b = blob(id, "image");
    assert.ok(b instanceof Blob);
    assert.equal(b.type, "image/png");
    assert.equal(Buffer.from(await b.arrayBuffer()).toString("utf8"), payload);

    evict(id);
});

test("entries are keyed by id AND field", () => {
    const id = 1003;
    const before = size();
    const ui = ensureUrl(id, "image", pngUrl);
    const ua = ensureUrl(id, "extra_avi", aviUrl);
    const uj = ensureUrl(id, "final_frame", jpegUrl);

    assert.notEqual(ui, ua);
    assert.notEqual(ui, uj);
    assert.equal(size(), before + 3);

    // The same field of a different id is a separate entry.
    const other = ensureUrl(id + 1, "image", pngUrl);
    assert.notEqual(other, ui);
    assert.equal(size(), before + 4);

    evict(id);
    evict(id + 1);
});

test("url/blob look up without building", () => {
    const id = 1004;
    assert.equal(url(id, "image"), null);
    assert.equal(blob(id, "image"), null);

    const u = ensureUrl(id, "final_frame", jpegUrl);
    assert.equal(url(id, "final_frame"), u);
    assert.ok(blob(id, "final_frame") instanceof Blob);
    assert.equal(blob(id, "final_frame")?.type, "image/jpeg");
    assert.equal(url(id, "image"), null);
    assert.equal(blob(id, "image"), null);

    evict(id);
});

test("an empty base64 payload decodes to an empty blob", async () => {
    const id = 1005;
    const u = ensureUrl(id, "image", "data:image/png;base64,");
    assert.match(u, /^blob:/);
    const b = blob(id, "image");
    assert.ok(b instanceof Blob);
    assert.equal(b.size, 0);

    evict(id);
});

test("evict revokes all URLs of one id and drops all its fields", () => {
    const id = 1006;
    const u1 = ensureUrl(id, "image", pngUrl);
    const u2 = ensureUrl(id, "extra_avi", aviUrl);
    const revocationsBefore = revoked.length;
    const sizeBefore = size();

    evict(id);

    assert.deepEqual(revoked.slice(revocationsBefore), [u1, u2]);
    assert.equal(url(id, "image"), null);
    assert.equal(blob(id, "extra_avi"), null);
    assert.equal(url(id, "final_frame"), null);
    assert.equal(size(), sizeBefore - 2);
});

test("evict of an unknown id is a no-op", () => {
    const sizeBefore = size();
    const revocationsBefore = revoked.length;

    assert.doesNotThrow(() => evict(999999));

    assert.equal(size(), sizeBefore);
    assert.equal(revoked.length, revocationsBefore);
});

test("evict leaves other ids' entries untouched", () => {
    const a = 1008;
    const b = 1009;
    const ua = ensureUrl(a, "image", pngUrl);
    const ub = ensureUrl(b, "image", jpegUrl);
    const revocationsBefore = revoked.length;

    evict(a);

    assert.deepEqual(revoked.slice(revocationsBefore), [ua]);
    assert.equal(url(a, "image"), null);
    assert.equal(url(b, "image"), ub);
    assert.ok(blob(b, "image") instanceof Blob);

    evict(b);
});

test("ensureUrl throws on a non-base64 data URL and caches nothing", () => {
    const id = 1010;
    assert.throws(() => ensureUrl(id, "image", "data:text/plain,not base64"), /Not a base64 data URL/);
    assert.equal(url(id, "image"), null);
    assert.equal(blob(id, "image"), null);
});
