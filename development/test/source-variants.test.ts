import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync, strToU8 } from "fflate";
import { openWorkspace } from "../src/store.js";
import { enqueueSource, processSource, run } from "../src/sources.js";
import { hash } from "../src/io.js";

test("legacy Word and RTF plus XMind XML and OPML retain complete source text", async () => {
  const root = mkdtempSync(join(tmpdir(), "buddy-source-variants-"));
  try {
    const store = await openWorkspace("variants", {
      home: join(root, "registry"),
      root: join(root, "projects"),
    });
    writeFileSync(
      join(root, "source.txt"),
      "第一项：从创作者的实际经历开始。\n最后一项：完整来源锚点_VARIANT_END",
    );
    for (const extension of ["doc", "rtf"])
      await run("/usr/bin/textutil", [
        "-convert",
        extension,
        "-output",
        join(root, `source.${extension}`),
        join(root, "source.txt"),
      ]);
    writeFileSync(
      join(root, "legacy.xmind"),
      zipSync({
        "content.xml": strToU8(
          '<?xml version="1.0"?><xmap-content xmlns="urn:xmind:xmap:xmlns:content:2.0"><sheet><title>知识结构</title><topic id="root"><title>创作者经验</title><children><topics type="attached"><topic id="last"><title>完整来源锚点_VARIANT_END</title></topic></topics></children></topic></sheet></xmap-content>',
        ),
      }),
    );
    writeFileSync(
      join(root, "outline.opml"),
      '<?xml version="1.0"?><opml version="2.0"><head><title>知识地图</title></head><body><outline text="创作者经验"><outline text="完整来源锚点_VARIANT_END"/></outline></body></opml>',
    );
    for (const file of [
      "source.doc",
      "source.rtf",
      "legacy.xmind",
      "outline.opml",
    ]) {
      const kind =
        file.endsWith(".xmind") || file.endsWith(".opml") ? "mindmap" : "file";
      const queued = enqueueSource(store, {
        operationId: `variant-${file}`,
        kind,
        uri: join(root, file),
      });
      const result = await processSource(store, queued.id);
      assert.equal(result.status, "ready", JSON.stringify(result.errorDetails));
      assert.deepEqual(result.processing, {
        acquisition: "complete",
        parsing: "complete",
        semanticReview: "requires_host_calibration",
      });
      assert.ok(
        result.chunks
          .map((c) => c.text)
          .join("")
          .includes("完整来源锚点_VARIANT_END"),
      );
      for (const f of result.files)
        assert.equal(hash(readFileSync(store.path(f.path))), f.hash);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
