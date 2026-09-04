import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SourceWorkflow } from "../src/source-workflow.js";
import { enqueueSource } from "../src/sources.js";
import { openWorkspace } from "../src/store.js";

test("source graph resumes a failed tool node in a later process lifetime without a new job", async () => {
  const root = mkdtempSync(join(tmpdir(), "buddy-source-graph-"));
  const store = await openWorkspace("source-graph", {
    home: join(root, "registry"),
    root: join(root, "projects"),
  });
  const source = enqueueSource(store, {
    operationId: "acquire-one",
    kind: "file",
    uri: join(root, "notes.txt"),
  });
  let graph = new SourceWorkflow(store);
  try {
    await assert.rejects(() => graph.run(source.id), /找不到/);
    assert.equal(store.source(source.id).status, "failed");
    graph.close();
    writeFileSync(
      join(root, "notes.txt"),
      "资料已经补齐，沿用同一个获取任务。",
    );
    graph = new SourceWorkflow(store);
    const result = await graph.run(source.id);
    assert.equal(result.jobId, source.jobId);
    assert.equal(result.status, "ready");
    assert.equal(result.attempt, 2);
    const rows = graph.saver.db
      .prepare("SELECT thread_id FROM checkpoints WHERE thread_id LIKE ?")
      .all("source:%");
    assert.ok(rows.length > 2);
    assert.equal((await graph.run(source.id)).version, result.version);
    assert.equal(store.source(source.id).attempt, 2);
  } finally {
    graph.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("source content saved before checkpoint failure is adopted exactly once after restart", async () => {
  const root = mkdtempSync(join(tmpdir(), "buddy-source-commit-"));
  const store = await openWorkspace("source-crash", {
    home: join(root, "registry"),
    root: join(root, "projects"),
  });
  const source = enqueueSource(store, {
    operationId: "oral-one",
    kind: "oral",
    text: "原文已保存，图检查点暂时未写入。",
  });
  let graph = new SourceWorkflow(store, () => {
    throw new Error("crash after source HEAD");
  });
  try {
    await assert.rejects(() => graph.run(source.id), /crash after/);
    const saved = store.source(source.id);
    assert.equal(saved.status, "ready");
    graph.close();
    graph = new SourceWorkflow(store);
    const recovered = await graph.run(source.id);
    assert.equal(recovered.version, saved.version);
    assert.equal(recovered.attempt, 1);
  } finally {
    graph.close();
    rmSync(root, { recursive: true, force: true });
  }
});
