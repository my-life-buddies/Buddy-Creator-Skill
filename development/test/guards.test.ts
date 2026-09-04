import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWorkspace } from "../src/store.js";
import { Workflow } from "../src/workflow.js";
import { hash, json } from "../src/io.js";
import { reduce, validateDelivery } from "../src/domain.js";
import { previewSnapshot, publishDraft, servePreview } from "../src/preview.js";
import type { Input, WorkItem, WorkResult } from "../src/types.js";

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "buddy-guards-"));
  const store = await openWorkspace("guards", {
    home: join(root, "registry"),
    root: join(root, "projects"),
  });
  const session = store.connect("test");
  let n = 0;
  const input = (text: string) =>
    store.record(session.id, store.reserve(session.id, `m${++n}`).token, text);
  const commit = (i: Input, r: WorkResult) => {
    const before = store.load(),
      id = `r${n}`,
      result = reduce(store, before, i, r, id);
    const receipt = result.conversationOnly
      ? store.conversation(result.delivery, id, hash(r))
      : store.commit(
          before.revision,
          result.state,
          result.delivery,
          id,
          id,
          hash(r),
        );
    store.presentation(receipt.deliveryId, "host_reported");
    return receipt;
  };
  return {
    root,
    store,
    session,
    input,
    commit,
    close: () => rmSync(root, { recursive: true, force: true }),
  };
}
const ask: WorkResult = {
  intent: "supplement",
  delivery: {
    text: "你希望搭子帮助哪类人完成哪一件具体的事？",
    questionTargetId: "D01",
  },
};

test("duplicate buddy directories require a choice and remember the selected canonical workspace", async () => {
  const f = await fixture();
  try {
    const copy = join(f.root, "projects", "guards-copy");
    cpSync(f.store.directory, copy, { recursive: true });
    const options = {
      home: join(f.root, "registry"),
      root: join(f.root, "projects"),
    };
    await assert.rejects(() => openWorkspace("guards", options), /多个相同/);
    const chosen = await openWorkspace("guards", {
      ...options,
      workspace: copy,
    });
    assert.equal(
      (await openWorkspace("guards", options)).directory,
      chosen.directory,
    );
  } finally {
    f.close();
  }
});

test("three answers close one target; explanation and failed follow-up never consume an extra answer", async () => {
  const f = await fixture();
  try {
    f.commit(f.input("开始"), ask);
    for (let n = 0; n < 2; n++)
      f.commit(f.input("还没有想清楚"), {
        intent: "answer",
        delivery: ask.delivery,
      });
    const before = hash(f.store.load()),
      question = f.store.dialogue().questionDeliveryId;
    f.commit(f.input("为什么要先问这件事"), {
      intent: "explain",
      delivery: {
        text: "了解这件事，是为了让后面的方法和服务有一个具体的出发点。你不需要现在就把整个产品想完整，可以先回忆一个真实的人和他遇到的困难；已经提供的经验会继续保留，暂时不确定的部分也可以留待后续整理。",
      },
    });
    assert.equal(hash(f.store.load()), before);
    assert.equal(f.store.dialogue().questionDeliveryId, question);
    const third = f.input("还是不确定");
    assert.throws(
      () => f.commit(third, { intent: "answer", delivery: ask.delivery }),
      /收敛|上限/,
    );
    assert.equal(f.store.load().targets.D01!.answerInputIds.length, 2);
    f.commit(third, {
      intent: "answer",
      delivery: {
        text: "这一点先保留为待补。你最想帮助的具体用户是谁？",
        questionTargetId: "D02",
      },
    });
    assert.equal(f.store.load().targets.D01!.status, "exhausted");
    assert.equal(f.store.load().targets.D01!.answerInputIds.length, 3);
  } finally {
    f.close();
  }
});

test("partial booklet is visible and versioned, but cannot be confirmed before required work", async () => {
  const f = await fixture();
  try {
    const i = f.input("先写下来：帮助新人整理周报");
    f.commit(i, {
      intent: "supplement",
      artifacts: [
        {
          id: "definition.1",
          stage: "definition",
          kind: "chapter",
          title: "定位",
          markdown: "帮助新人整理周报",
          evidence: [{ type: "input", id: i.id, hash: i.hash, quote: i.raw }],
          dependencies: [],
          unresolved: [],
        },
      ],
      delivery: {
        text: "已整理定位草稿，其他部分仍待讨论。",
        confirmationObjectIds: ["definition.1"],
      },
    });
    const view = previewSnapshot(f.store);
    assert.equal(view.artifacts[0]!.status, "pending");
    assert.ok(view.artifacts[0]!.unresolved.length);
    const yes = f.input("确认"),
      target = f.store.delivery(yes.replyToDeliveryId!).confirmationTarget!;
    assert.throws(
      () =>
        f.commit(yes, {
          intent: "confirm",
          confirmation: {
            target,
            decision: "confirmed",
            evidence: [
              { type: "input", id: yes.id, hash: yes.hash, quote: yes.raw },
            ],
          },
          delivery: { text: "确认完成。" },
        }),
      /未决|门槛/,
    );
    assert.equal(f.store.load().confirmations.length, 0);
  } finally {
    f.close();
  }
});

test("lost input reply repairs its index without reviving an older message", async () => {
  const f = await fixture();
  try {
    const a = f.input("第一条"),
      b = f.input("第二条");
    json(f.store.path("dialogue.json"), { latestInputId: a.id });
    f.store.record(f.session.id, b.token, b.raw);
    assert.equal(f.store.dialogue().latestInputId, b.id);
    f.store.record(f.session.id, a.token, a.raw);
    assert.equal(f.store.dialogue().latestInputId, b.id);
  } finally {
    f.close();
  }
});

test("drafts stop accepting writes when the work item is accepted or paused", async () => {
  const f = await fixture(),
    flow = new Workflow(f.store);
  try {
    const i = f.input("开始"),
      next = await flow.prepare(f.session.id, i.id, "revision"),
      item = next.workItem as WorkItem;
    const draft = {
      stepId: item.stepId,
      contextDigest: item.contextDigest,
      sequence: 1,
      markdown: "定位草稿",
      title: "定位",
    };
    publishDraft(f.store, f.session.id, draft);
    assert.equal(previewSnapshot(f.store).drafts.length, 1);
    await flow.complete(item.requestId, {
      stepId: item.stepId,
      operationId: "accepted-1",
      operationEpoch: item.operationEpoch,
      baseRevision: item.baseRevision,
      contextDigest: item.contextDigest,
      output: ask,
    });
    assert.throws(
      () => publishDraft(f.store, f.session.id, { ...draft, sequence: 2 }),
      /提交结果|暂停/,
    );
    assert.equal(previewSnapshot(f.store).drafts.length, 0);
  } finally {
    flow.close();
    f.close();
  }
});

test("transition questions enforce the special format and one decision binding", () => {
  assert.throws(
    () =>
      validateDelivery({
        intent: "answer",
        delivery: { text: "何时续费？", questionTargetId: "T.paid-paid.1" },
      }),
    /两段/,
  );
  validateDelivery({
    intent: "answer",
    delivery: {
      text: "接下来我们讨论月度服务即将结束时的安排：你希望在什么时点邀请用户继续下个月的服务？\n\n比如，小林这周刚完成最后一次写作复盘，距离到期还有三天，你希望在什么情况下向她提起下个月的服务？",
      questionTargetId: "T.paid-paid.1",
      mode: "transition",
    },
  });
});

test("preview rejects writes and foreign origins, streams updates, and exposes no interview counts", async () => {
  const f = await fixture();
  const { server, url } = await servePreview(f.store);
  const controller = new AbortController();
  try {
    assert.equal(
      (await fetch(url + "api/snapshot", { method: "POST" })).status,
      405,
    );
    assert.equal(
      (
        await fetch(url + "api/snapshot", {
          headers: { Origin: "https://example.com" },
        })
      ).status,
      403,
    );
    assert.equal((await fetch(new URL("/api/snapshot", url))).status, 404);
    const stream = await fetch(url + "api/events", {
        signal: controller.signal,
      }),
      reader = stream.body!.getReader();
    await reader.read();
    f.commit(f.input("开始"), ask);
    const change = await reader.read();
    assert.match(new TextDecoder().decode(change.value), /event: changed/);
    const snapshot = await (await fetch(url + "api/snapshot")).text();
    assert.ok(!snapshot.includes("answerInputIds"));
    assert.ok(!snapshot.includes("maxAnswers"));
    assert.match(snapshot, /guards/);
    // Recovery must notify the browser even if the saved revision did not change.
    const load = f.store.load.bind(f.store);
    try {
      f.store.load = () => { throw new Error("temporary read failure"); };
      let event = "";
      while (!event.includes("event: unavailable")) event = new TextDecoder().decode((await reader.read()).value);
      f.store.load = load;
      const recovery = new TextDecoder().decode((await reader.read()).value);
      assert.match(recovery, /event: changed/);
    } finally { f.store.load = load; }
  } finally {
    controller.abort();
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    f.close();
  }
});
