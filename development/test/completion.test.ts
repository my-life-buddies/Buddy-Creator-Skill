import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { fixture, revision } from "./helpers/confirmed-project.js";
import { completionSnapshot, ensureCompletion, withCompletion } from "../src/completion.js";
import { hash, json } from "../src/io.js";

test("confirmed books finalize atomically to local files without a ZIP or coding task", async (t) => {
  const f = await fixture(t);
  const head = readFileSync(f.store.path("HEAD.json"), "utf8");
  const [first, second] = await Promise.all([ensureCompletion(f.store), ensureCompletion(f.store)]);
  assert.equal(first?.status, "ready", JSON.stringify(first));
  assert.deepEqual(second, first);
  const directory = f.store.path("deliverables", first!.revision);
  const manifest = JSON.parse(readFileSync(`${directory}/MANIFEST.json`, "utf8"));
  for (const file of manifest.files) {
    const bytes = readFileSync(`${directory}/${file.path}`);
    assert.equal(bytes.length, file.bytes);
    assert.equal(hash(bytes), file.sha256);
  }
  assert.equal(readdirSync(`${directory}/booklets`).length, 4);
  assert.ok(readFileSync(`${directory}/BUDDY_MANUAL.md`, "utf8").length > 100);
  assert.equal(existsSync(f.store.path("exports")), false);
  assert.equal(existsSync(f.store.path("handoffs")), false);
  assert.equal(readFileSync(f.store.path("HEAD.json"), "utf8"), head);
  assert.equal(JSON.stringify(completionSnapshot(f.store)).includes(f.root), false);
  assert.equal((await withCompletion(f.store, {})).completion?.manualPath, `${directory}/BUDDY_MANUAL.md`);
});

test("incomplete, paused, and cross-host pending corrections do not finalize", async (t) => {
  const incomplete = await fixture(t, false);
  assert.equal(await ensureCompletion(incomplete.store), undefined);
  const f = await fixture(t);
  json(f.store.path("session.json"), { ...f.session, paused: true });
  assert.equal(await ensureCompletion(f.store), undefined);
  json(f.store.path("session.json"), f.session);
  const ticket = f.store.reserve(f.session.id, "correction");
  f.store.record(f.session.id, ticket.token, "等等，我想调整订阅时长。");
  f.store.connect("workbuddy", undefined, true);
  assert.equal(await ensureCompletion(f.store), undefined);
  assert.equal(completionSnapshot(f.store), undefined);
});

test("failed generation retries without changing confirmations; missing derived files recover", async (t) => {
  const f = await fixture(t);
  const state = f.store.load();
  const source = f.store.source(state.sourcePlan.sourceIds[0]!);
  const file = f.store.path(source.files[0]!.path);
  const original = readFileSync(file);
  writeFileSync(file, "changed");
  const failed = await ensureCompletion(f.store);
  assert.equal(failed?.status, "failed");
  assert.equal(existsSync(f.store.path("deliverables", state.revision)), false);
  assert.equal(completionSnapshot(f.store)?.status, "failed");
  writeFileSync(file, original);
  const recovered = await ensureCompletion(f.store);
  assert.equal(recovered?.status, "ready");
  const manual = f.store.path("deliverables", state.revision, "BUDDY_MANUAL.md");
  rmSync(manual);
  assert.equal(completionSnapshot(f.store)?.status, "failed");
  assert.equal((await ensureCompletion(f.store))?.status, "ready");
  assert.ok(existsSync(manual));
  assert.deepEqual(f.store.load(), state);
});

test("legacy mock records remain untouched and never become completion status", async (t) => {
  const f = await fixture(t);
  const legacy = f.store.path("handoffs", "coding", "old", "status.json");
  json(legacy, { status: "accepted", mode: "mock", revision: f.store.load().revision });
  const original = readFileSync(legacy, "utf8");
  assert.equal(completionSnapshot(f.store), undefined);
  await ensureCompletion(f.store);
  assert.equal(readFileSync(legacy, "utf8"), original);
  revision(f.store, (state) => { state.artifacts["definition.1"]!.hash = hash("new draft"); }, "new-draft");
  assert.equal(completionSnapshot(f.store), undefined);
  assert.equal(await ensureCompletion(f.store), undefined);
});
