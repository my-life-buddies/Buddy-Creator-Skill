import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { once } from "node:events";
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
test("redirects cannot re-enable removed web collection", async (t) => {
  const server = createServer((_req, res) => { res.writeHead(302, { location: "https://www.xiaohongshu.com/user/profile/example" }); res.end(); });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => { server.closeAllConnections(); server.close(); });
  const port = (server.address() as import("node:net").AddressInfo).port;
  await assert.rejects(readableWeb(`http://127.0.0.1:${port}/`), unsupported);
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
