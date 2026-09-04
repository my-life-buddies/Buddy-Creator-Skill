import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWorkspace } from "../src/store.js";
import { Workflow } from "../src/workflow.js";
import { hash } from "../src/io.js";
import { reduce } from "../src/domain.js";
import type { WorkItem, WorkResult } from "../src/types.js";

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "buddy-runtime-"));
  const store = await openWorkspace("creator-1", {
    home: join(root, "registry"),
    root: join(root, "projects"),
  });
  const session = store.connect("test");
  return { root, store, session };
}
async function input(
  f: Awaited<ReturnType<typeof fixture>>,
  key: string,
  raw: string,
) {
  const t = f.store.reserve(f.session.id, key);
  return f.store.record(f.session.id, t.token, raw);
}
async function complete(
  flow: Workflow,
  d: Record<string, unknown>,
  output: WorkResult,
  operationId = "work-1",
) {
  const item = d.workItem as WorkItem;
  return flow.complete(item.requestId, {
    stepId: item.stepId,
    operationId,
    contextDigest: item.contextDigest,
    baseRevision: item.baseRevision,
    operationEpoch: item.operationEpoch,
    output,
  });
}
const opening: WorkResult = {
  intent: "supplement",
  delivery: {
    text: "我们先从你最想帮助的人开始：你希望这个 Buddy 帮他完成哪一件具体的事？",
    questionTargetId: "D01",
  },
};

test("revision work skips review unless an actual conflict scope is supplied", async () => {
  const f = await fixture(),
    flow = new Workflow(f.store);
  try {
    const raw = await input(f, "simple-revision", "只是把这段话写得简短些。");
    const prepared = await flow.prepare(f.session.id, raw.id, "revision");
    const item = prepared.workItem as WorkItem;
    assert.equal(item.status, "issued");
    assert.deepEqual(item.requiredEvidenceRefs, [`input:${raw.id}`]);
    const next = await complete(
      flow,
      prepared,
      { intent: "revise", delivery: { text: "本轮仅调整表达。" } },
      "simple-work",
    );
    assert.equal((next.workItem as WorkItem).kind, "delivery_compose");
    assert.equal(flow.turn(item.requestId).plan.length, 2);
  } finally {
    flow.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("durable host interrupt, accepted work, commit crash, original receipt, no repeat count", async () => {
  const f = await fixture();
  let flow = new Workflow(f.store);
  try {
    const first = await input(f, "message-1", "开始创作");
    let d = await flow.prepare(f.session.id, first.id);
    const request = d.requestId as string;
    assert.equal(d.directive, "host_work");
    const stableStep = (d.workItem as WorkItem).stepId;
    flow.close();
    flow = new Workflow(f.store);
    d = await flow.next(request);
    assert.equal((d.workItem as WorkItem).stepId, stableStep);
    await complete(flow, d, opening);
    flow.close();
    flow = new Workflow(f.store, () => {
      throw new Error("simulated crash after HEAD");
    });
    await assert.rejects(
      () => flow.commit(request, "commit-1"),
      /simulated crash/,
    );
    const committedRevision = f.store.load().revision;
    flow.close();
    flow = new Workflow(f.store);
    d = await flow.next(request);
    assert.equal(d.directive, "deliver");
    assert.equal(f.store.load().revision, committedRevision);
    const receipt = d.receipt as { deliveryId: string };
    f.store.presentation(receipt.deliveryId, "host_reported");
    const second = await input(
      f,
      "message-2",
      "我想帮助刚入职的新同事把工作周报写清楚。",
    );
    const same = f.store.record(f.session.id, second.token, second.raw);
    assert.equal(same.id, second.id);
    const reply = await flow.prepare(f.session.id, second.id);
    await complete(
      flow,
      reply,
      {
        intent: "answer",
        assessments: [
          {
            targetId: "D01",
            status: "sufficient",
            summary: "帮助新同事写清工作周报",
            gaps: [],
            evidence: [
              {
                type: "input",
                id: second.id,
                hash: second.hash,
                quote: second.raw,
              },
            ],
          },
        ],
        delivery: {
          text: "你提到刚入职的新同事。可以想起一位具体的人吗——他准备周报时，最常卡在哪个地方？",
          questionTargetId: "D02",
        },
      },
      "work-2",
    );
    await flow.commit(reply.requestId as string, "commit-2");
    assert.equal(f.store.load().targets.D01!.answerInputIds.length, 1);
    const historical = await flow.commit(request, "commit-1");
    assert.equal(historical.directive, "await_user");
    assert.equal(historical.supersededDeliveryId, receipt.deliveryId);
    assert.equal(f.store.load().targets.D01!.answerInputIds.length, 1);
    const deliberate = await input(f, "message-3", second.raw);
    assert.notEqual(deliberate.id, second.id);
  } finally {
    flow.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("dependency work resumes at next item and local repairs preserve accepted prefix", async () => {
  const f = await fixture();
  let flow = new Workflow(f.store);
  try {
    const seed = await input(
      f,
      "seed-conflict",
      "目标用户是独立老师，但责任边界暂时写成只帮助学生。",
    );
    const proposal: WorkResult = {
      intent: "supplement",
      artifacts: [
        ["definition.2", "目标用户", "独立老师"],
        ["definition.6", "责任边界", "只帮助学生"],
      ].map(([id, title, markdown]) => ({
        id: id!,
        title: title!,
        markdown: markdown!,
        kind: "chapter",
        stage: "definition",
        dependencies: [],
        unresolved: [],
        evidence: [
          { type: "input", id: seed.id, hash: seed.hash, quote: seed.raw },
        ],
      })),
      delivery: { text: "两个有待校准的章节已记录。你希望搭子先帮用户完成哪件事？", questionTargetId: "D01" },
    };
    const seeded = reduce(
      f.store,
      f.store.load(),
      seed,
      proposal,
      "seed-conflict",
    );
    f.store.commit(
      f.store.load().revision,
      seeded.state,
      seeded.delivery,
      "seed-conflict",
      "seed-conflict",
      hash(proposal),
    );
    const raw = await input(f, "revise", "定位先改为帮助独立老师备课");
    let d = await flow.prepare(f.session.id, raw.id, "revision", {
      objectIds: ["definition.2", "definition.6"],
      reason: "目标用户是老师，但当前责任边界写成只帮助学生。",
    });
    await complete(
      flow,
      d,
      { intent: "revise", delivery: { text: "候选修订已准备。" } },
      "revise-work",
    );
    flow.close();
    flow = new Workflow(f.store);
    d = await flow.next(d.requestId as string);
    const item = d.workItem as WorkItem;
    assert.equal(item.kind, "conflict_review");
    assert.equal(item.dependsOn.length, 1);
    const before = item.dependsOn[0];
    await assert.rejects(() =>
      complete(
        flow,
        d,
        {
          intent: "revise",
          artifacts: [
            {
              id: "outside",
              stage: "definition",
              kind: "chapter",
              title: "x",
              markdown: "x",
              evidence: [],
              dependencies: [],
              unresolved: [],
            },
          ],
          delivery: { text: "x" },
        },
        "bad-work",
      ),
    );
    d = await flow.next(item.requestId);
    assert.equal((d.workItem as WorkItem).dependsOn[0], before);
    await complete(
      flow,
      d,
      { intent: "revise", delivery: { text: "没有新增冲突。" } },
      "review-work",
    );
    d = await flow.next(item.requestId);
    assert.equal((d.workItem as WorkItem).kind, "delivery_compose");
    await complete(
      flow,
      d,
      {
        intent: "revise",
        delivery: {
          text: "你希望帮助独立老师备课。为了让搭子的任务具体一些，你最希望先解决备课中的哪一件事？",
          questionTargetId: "D01",
        },
      },
      "compose-work",
    );
    await flow.commit(item.requestId, "revise-commit");
    assert.equal(f.store.load().targets.D01!.answerInputIds.length, 0);
  } finally {
    flow.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("cancelled execution rejects late host output before resume", async () => {
  const f = await fixture(),
    flow = new Workflow(f.store);
  try {
    const raw = await input(f, "start", "开始");
    const d = await flow.prepare(f.session.id, raw.id);
    flow.cancel(f.session.id);
    await assert.rejects(() => complete(flow, d, opening), /替代|接替/);
    assert.equal(f.store.load().revision, "rev_initial");
  } finally {
    flow.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("same buddyid resolves canonical directory, exact input identity rejects altered replay", async () => {
  const f = await fixture();
  try {
    const again = await openWorkspace("creator-1", {
      home: join(f.root, "registry"),
      root: join(f.root, "other-root"),
    });
    assert.equal(again.directory, f.store.directory);
    const raw = await input(f, "one", "相同的文字");
    assert.throws(
      () => f.store.record(f.session.id, raw.token, "换掉文字"),
      /不同内容/,
    );
    assert.equal(hash(f.store.load()), hash(again.load()));
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
