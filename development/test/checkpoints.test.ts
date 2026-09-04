import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  emptyCheckpoint,
  WRITES_IDX_MAP,
} from "@langchain/langgraph-checkpoint";
import { SqliteSaver } from "../src/checkpoints.js";

test("portable SQLite preserves namespaces, typed writes, parent links, filters and idempotent writes across reopen", async () => {
  const root = mkdtempSync(join(tmpdir(), "buddy-sqlite-"));
  let saver = SqliteSaver.fromConnString(join(root, "checkpoints.sqlite"));
  try {
    const a = emptyCheckpoint();
    a.id = "0001";
    a.channel_values = {
      message: "中文",
      bytes: new Uint8Array([0, 127, 255]),
    };
    const c = await saver.put(
      { configurable: { thread_id: "one", checkpoint_ns: "ns" } },
      a,
      { source: "input", step: 0, parents: {}, nullable: null } as any,
    );
    await saver.putWrites(c, [["value", { text: "first" }]], "task");
    await saver.putWrites(c, [["value", { text: "replayed" }]], "task");
    const special = Object.keys(WRITES_IDX_MAP)[0]!;
    await saver.putWrites(c, [[special, { text: "first" }]], "repair");
    await saver.putWrites(c, [[special, { text: "latest" }]], "repair");
    const b = emptyCheckpoint();
    b.id = "0002";
    await saver.put(c, b, { source: "loop", step: 1, parents: {} });
    const other = emptyCheckpoint();
    other.id = "0003";
    await saver.put({ configurable: { thread_id: "two" } }, other, {
      source: "input",
      step: 0,
      parents: {},
    });
    saver.db.close();
    saver = SqliteSaver.fromConnString(join(root, "checkpoints.sqlite"));
    const first = (await saver.getTuple(c))!;
    assert.deepEqual(first.checkpoint.channel_values, a.channel_values);
    assert.deepEqual(first.pendingWrites?.find((w) => w[1] === "value")?.[2], {
      text: "first",
    });
    assert.deepEqual(first.pendingWrites?.find((w) => w[1] === special)?.[2], {
      text: "latest",
    });
    assert.equal(
      (await saver.getTuple({
        configurable: { thread_id: "one", checkpoint_ns: "ns" },
      }))!.parentConfig!.configurable!.checkpoint_id,
      "0001",
    );
    assert.equal(
      (
        await Array.fromAsync(
          saver.list(
            { configurable: { thread_id: "one" } },
            { filter: { source: "input" }, limit: 1 },
          ),
        )
      )[0]!.checkpoint.id,
      "0001",
    );
    assert.equal(
      (
        await Array.fromAsync(
          saver.list(
            { configurable: { thread_id: "one" } },
            { before: { configurable: { checkpoint_id: "0002" } } },
          ),
        )
      ).length,
      1,
    );
    await saver.deleteThread("one");
    assert.equal(
      (
        await Array.fromAsync(
          saver.list({ configurable: { thread_id: "one" } }),
        )
      ).length,
      0,
    );
    assert.equal(
      (await saver.getTuple({ configurable: { thread_id: "two" } }))!.checkpoint
        .id,
      "0003",
    );
  } finally {
    saver.db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
