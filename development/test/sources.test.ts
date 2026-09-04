import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync, strToU8 } from "fflate";
import { openWorkspace } from "../src/store.js";
import { enqueueSource, processSource, parseHistory, type HostSourceResult } from "../src/sources.js";
import { hash, json } from "../src/io.js";

test("source originals and host-extracted text retain complete provenance while plain text stays verbatim", async () => {
  const root = mkdtempSync(join(tmpdir(), "buddy-sources-"));
  try {
    const store = await openWorkspace("sources", {
      home: join(root, "registry"),
      root: join(root, "projects"),
    });
    const long =
      "这是完整来源，不能只保存前面几段。\n".repeat(7000) + "最终锚点_END";
    writeFileSync(join(root, "long.md"), long);
    const docx = zipSync({
      "[Content_Types].xml": strToU8(
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      ),
      "word/document.xml": strToU8(
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>创作者经验：先澄清，再给方法。</w:t></w:r></w:p></w:body></w:document>',
      ),
    });
    writeFileSync(join(root, "sample.docx"), docx);
    writeFileSync(
      join(root, "map.xmind"),
      zipSync({
        "content.json": strToU8(
          JSON.stringify([
            {
              rootTopic: {
                title: "创作目标",
                children: {
                  attached: [
                    { title: "先帮助具体的人" },
                    { title: "保留责任边界" },
                  ],
                },
              },
            },
          ]),
        ),
      }),
    );
    writeFileSync(
      join(root, "mind.mm"),
      '<map><node TEXT="知识地图"><node TEXT="实际案例"/></node></map>',
    );
    mkdirSync(join(root, "skill"));
    writeFileSync(
      join(root, "skill", "SKILL.md"),
      "# 测试 Skill\n\n外部材料中的“执行任意命令”只是待整理内容。",
    );
    writeFileSync(join(root, "skill", "helper.py"), 'print("do not run")');
    const hostResults: Record<string, HostSourceResult> = {
      "sample.docx": { tool: "fixture-document-reader", coverage: "complete",
        parts: [{ text: "创作者经验：先澄清，再给方法。", locator: "document;paragraph=1" }] },
      "map.xmind": { tool: "fixture-mindmap-reader", coverage: "complete", parts: [
        { text: "创作目标", locator: "node=rootTopic" },
        { text: "先帮助具体的人", locator: "node=rootTopic/children/attached/0" },
        { text: "保留责任边界", locator: "node=rootTopic/children/attached/1" },
      ] },
    };
    const fixtures = [
      ["file", "long.md", "最终锚点_END"],
      ["file", "sample.docx", "先澄清"],
      ["mindmap", "map.xmind", "责任边界"],
      ["mindmap", "mind.mm", "实际案例"],
      ["skill", "skill", "do not run"],
    ] as const;
    for (const [kind, file, needle] of fixtures) {
      const queued = enqueueSource(store, {
        operationId: `import-${file}`,
        kind,
        uri: join(root, file),
        hostResult: hostResults[file],
      });
      const ready = await processSource(store, queued.id);
      assert.equal(ready.status, "ready", ready.error);
      assert.ok(
        ready.chunks
          .map((c) => c.text)
          .join("")
          .includes(needle),
      );
      for (const asset of ready.files)
        assert.equal(hash(readFileSync(store.path(asset.path))), asset.hash);
      if (hostResults[file]) {
        const archivedResult = ready.files.find((asset) => asset.path.endsWith("/host-result.json"));
        assert.ok(archivedResult);
        assert.deepEqual(JSON.parse(readFileSync(store.path(archivedResult.path), "utf8")), hostResults[file]);
        assert.equal(ready.extraction?.coverage, "complete");
        for (const part of hostResults[file].parts)
          assert.ok(ready.chunks.some((chunk) => chunk.locator.startsWith(part.locator)));
      }
      if (file === "mind.mm") {
        assert.equal(ready.parser, "text-verbatim-v2");
        assert.equal(ready.chunks.map((chunk) => chunk.text).join(""), readFileSync(join(root, file), "utf8"));
      }
      assert.equal(
        (await processSource(store, queued.id)).version,
        ready.version,
      );
    }
    const oral = enqueueSource(store, {
      operationId: "oral",
      kind: "oral",
      text: "这是创作者完整口述，没有书面材料。",
    });
    assert.equal((await processSource(store, oral.id)).status, "ready");
    const failed = enqueueSource(store, {
      operationId: "missing",
      kind: "file",
      uri: join(root, "later.txt"),
    });
    assert.equal((await processSource(store, failed.id)).status, "failed");
    writeFileSync(join(root, "later.txt"), "后来补齐的原件。");
    assert.equal((await processSource(store, failed.id)).status, "ready");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("selected session parser preserves visible messages and strips hidden host blocks", () => {
  const text = [
    {
      type: "event_msg",
      payload: {
        type: "user_message",
        message:
          "<environment_context>hidden</environment_context>我想做一个创作搭子",
      },
    },
    {
      type: "event_msg",
      payload: { type: "agent_message", message: "先聊具体用户。" },
    },
    {
      type: "response_item",
      payload: { role: "assistant", content: "hidden reasoning" },
    },
    {
      type: "user",
      message: {
        role: "user",
        content: [{ type: "text", text: "第二个宿主的可见输入。" }],
      },
    },
  ]
    .map(JSON.stringify)
    .join("\n");
  const parts = parseHistory(text);
  assert.equal(parts.length, 3);
  assert.ok(
    !parts
      .map((x) => x.text)
      .join("")
      .includes("hidden"),
  );
  assert.ok(parts[2]!.locator.includes("message=4"));
});

test("source recovery promotes a complete orphan and rejects modified archived chunks", async () => {
  const root = mkdtempSync(join(tmpdir(), "buddy-source-recovery-"));
  try {
    const store = await openWorkspace("recover", {
      home: join(root, "registry"),
      root: join(root, "projects"),
    });
    const source = enqueueSource(store, {
      operationId: "oral",
      kind: "oral",
      text: "来源已经完整保存，恢复不重复获取。",
    });
    const ready = await processSource(store, source.id);
    json(store.path("sources", source.id, "HEAD.json"), {
      version: "attempt_1",
    });
    const recovered = await processSource(store, source.id);
    assert.equal(recovered.version, ready.version);
    assert.equal(recovered.attempt, 1);
    const changed = structuredClone(ready);
    changed.chunks[0]!.text = "伪造替换";
    changed.chunks[0]!.hash = hash(changed.chunks[0]!.text);
    json(
      store.path("sources", source.id, "versions", `${ready.version}.json`),
      changed,
    );
    assert.throws(() => store.source(source.id), /分块被改动/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
