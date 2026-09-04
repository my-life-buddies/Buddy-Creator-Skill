import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync, strToU8 } from "fflate";
import { openWorkspace } from "../src/store.js";
import { enqueueSource, processSource } from "../src/sources.js";
import { hash } from "../src/io.js";
import { sourceNeedsHostResult } from "../src/source-policy.js";

test("host conversion results retain original files, locations and incomplete coverage without platform converters", async () => {
  const root = mkdtempSync(join(tmpdir(), "buddy-source-variants-"));
  try {
    const store = await openWorkspace("variants", {
      home: join(root, "registry"),
      root: join(root, "projects"),
    });
    // These fixtures are archived byte-for-byte; no local converter is invoked to create or read them.
    writeFileSync(join(root, "source.doc"), Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
    writeFileSync(join(root, "source.rtf"), "{\\rtf1\\ansi archived source fixture}");
    writeFileSync(join(root, "source.pdf"), "%PDF-1.7\n% archive-only fixture\n%%EOF");
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
      "source.pdf",
      "legacy.xmind",
      "outline.opml",
    ]) {
      const kind =
        file.endsWith(".xmind") || file.endsWith(".opml") ? "mindmap" : "file";
      const hostResult = {
        tool: "fixture-host-reader",
        coverage: "complete" as const,
        parts: [{ text: "第一项：从创作者的实际经历开始。\n最后一项：完整来源锚点_VARIANT_END", locator: file.endsWith(".pdf") ? "page=1" : "paragraph=1;source-position=unavailable" }],
        notes: ["测试归档契约：已提供确定的宿主结果，不调用文档转换器。"],
      };
      const queued = enqueueSource(store, {
        operationId: `variant-${file}`,
        kind,
        uri: join(root, file),
        hostResult,
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
      const original = result.files.find((asset) => asset.path.endsWith(`/original-${file}`));
      const extracted = result.files.find((asset) => asset.path.endsWith("/host-result.json"));
      assert.ok(original);
      assert.ok(extracted);
      assert.deepEqual(readFileSync(store.path(original.path)), readFileSync(join(root, file)));
      assert.deepEqual(JSON.parse(readFileSync(store.path(extracted.path), "utf8")), hostResult);
      assert.ok(result.chunks[0]?.locator.startsWith(hostResult.parts[0]!.locator));
      if (file === "source.doc") {
        const partial = enqueueSource(store, { operationId: "partial-doc", kind,
          uri: join(root, file), hostResult: { ...hostResult, coverage: "partial" } });
        const incomplete = await processSource(store, partial.id);
        assert.equal(incomplete.status, "failed");
        assert.equal(incomplete.extraction?.coverage, "partial");
        assert.equal(incomplete.processing?.parsing, "partial");
        assert.ok(incomplete.chunks.length);
        assert.ok(incomplete.files.some((asset) => asset.path.endsWith("/host-result.json")));
        assert.equal(sourceNeedsHostResult(incomplete), true);
        assert.equal((await processSource(store, partial.id)).version, incomplete.version);
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
