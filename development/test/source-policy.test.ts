import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openWorkspace } from "../src/store.js";
import { enqueueSource, processSource, readableWeb } from "../src/sources.js";
import { sourceView } from "../src/source-policy.js";
import { SourceWorkflow } from "../src/source-workflow.js";
import { BuddyError, json } from "../src/io.js";

const unsupported = (error: unknown) => error instanceof BuddyError && error.code === "SOURCE_UNSUPPORTED";
async function workspace(t: import("node:test").TestContext) {
  const root = mkdtempSync(join(tmpdir(), "buddy-source-policy-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return openWorkspace("writer", { home: join(root, "home"), root: join(root, "projects") });
}
test("account collection and generic-web bypass are rejected, while pasted material works", async (t) => {
  const store = await workspace(t);
  assert.throws(() => enqueueSource(store, { operationId: "account", kind: "xiaohongshu", uri: "https://www.xiaohongshu.com/user/profile/example" }), unsupported);
  assert.throws(() => enqueueSource(store, { operationId: "web", kind: "webpage", uri: "https://www.xiaohongshu.com/explore/example" }), unsupported);
  const pasted = enqueueSource(store, { operationId: "paste", kind: "oral", text: "这是我自行提供的笔记原文，用来整理已有写作经验。" });
  assert.equal((await processSource(store, pasted.id)).status, "ready");
});
test("webpages require recorded host results and removed domains stay blocked", async (t) => {
  const store = await workspace(t);
  const hostRequired = (error: unknown) => error instanceof BuddyError && error.code === "HOST_SOURCE_REQUIRED";
  const hostResult = { tool: "fixture-browser-reader", coverage: "complete" as const,
    parts: [{ text: "创作者已选择的网页内容，由宿主工具实际读取并提供。", locator: "url=https://example.com/article;paragraph=1" }] };
  assert.throws(() => enqueueSource(store, { operationId: "no-host", kind: "webpage", uri: "https://example.com/article" }), hostRequired);
  await assert.rejects(readableWeb("https://example.com/article"), hostRequired);
  for (const uri of ["https://www.xiaohongshu.com/explore/example", "https://xhslink.com/example"])
    assert.throws(() => enqueueSource(store, { operationId: "blocked-host", kind: "webpage", uri, hostResult }), unsupported);
  const source = enqueueSource(store, { operationId: "web-host", kind: "webpage", uri: "https://example.com/article", hostResult });
  const archived = await processSource(store, source.id);
  assert.equal(archived.status, "ready");
  assert.equal(archived.parser, "host-webpage-snapshot-v1");
  assert.ok(!archived.files.some((file) => file.path.endsWith(".html")));
  const file = archived.files.find((asset) => asset.path.endsWith("/webpage-snapshot.json"));
  assert.ok(file);
  const snapshot = JSON.parse(readFileSync(store.path(file.path), "utf8"));
  assert.equal(snapshot.archiveKind, "host-extracted-snapshot");
  assert.equal(snapshot.url, "https://example.com/article");
  assert.deepEqual(snapshot.hostResult, hostResult);
});
test("unfinished legacy jobs remain immutable and cannot run or resume", async (t) => {
  const store = await workspace(t);
  const queued = enqueueSource(store, { operationId: "legacy", kind: "oral", text: "legacy fixture" });
  const path = store.path("sources", queued.id, "versions", "queued.json");
  json(path, { ...queued, kind: "xiaohongshu" });
  const before = readFileSync(path, "utf8");
  assert.equal(sourceView(store.source(queued.id)).status, "failed");
  assert.match(sourceView(store.source(queued.id)).error!, /不再采集/);
  await assert.rejects(processSource(store, queued.id), unsupported);
  const flow = new SourceWorkflow(store);
  try { await assert.rejects(flow.run(queued.id), unsupported); } finally { flow.close(); }
  assert.equal(readFileSync(path, "utf8"), before);
});
test("ready legacy archives stay readable without invoking their former collector", async (t) => {
  const store = await workspace(t);
  const queued = enqueueSource(store, { operationId: "archive", kind: "oral", text: "已经归档的原文，应保留原始资料与出处。" });
  const ready = await processSource(store, queued.id);
  const legacy = { ...ready, kind: "xiaohongshu" as const };
  json(store.path("sources", ready.id, "versions", `${ready.version}.json`), legacy);
  assert.deepEqual(await processSource(store, ready.id), JSON.parse(JSON.stringify(legacy)));
  const flow = new SourceWorkflow(store);
  try { assert.deepEqual(await flow.run(ready.id), JSON.parse(JSON.stringify(legacy))); } finally { flow.close(); }
  assert.equal(sourceView(legacy).status, "ready");
});
