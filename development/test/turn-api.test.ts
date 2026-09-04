import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWorkspace } from "../src/store.js";
import { TurnAPI, stageRules } from "../src/turn-api.js";
import { hash } from "../src/io.js";
import type { WorkResult } from "../src/types.js";

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "buddy-turn-api-"));
  const store = await openWorkspace("fast-test", {
    home: join(root, "registry"),
    root: join(root, "projects"),
  });
  const session = store.connect("test");
  const text = "你希望这个搭子帮助谁完成哪件具体的事？";
  store.publishCommittedDelivery({
    id: "delivery_initial",
    requestId: "initial",
    revision: store.load().revision,
    text,
    hash: hash(text),
    kind: "content",
    question: {
      id: "initial",
      targetId: "D01",
      cycleId: store.load().targets.D01!.cycleId,
      mode: "ordinary",
    },
  });
  return { root, store, session };
}
function answer(d: any): WorkResult {
  const i = d.context.input;
  return {
    intent: "answer",
    assessments: [
      {
        targetId: "D01",
        status: "sufficient",
        summary: "帮助同事写清周报",
        gaps: [],
        evidence: [{ type: "input", id: i.id, hash: i.hash, quote: i.raw }],
      },
    ],
    delivery: { text: "你想到的这位同事，在写周报时最常遇到什么困难？", questionTargetId: "D02" },
  };
}

test("begin/finish retain exact input and presentation identity, compact rules, replay and old-delivery suppression", async () => {
  const f = await fixture();
  let api = new TurnAPI(f.store);
  try {
    const args = {
      sessionId: f.session.id,
      clientKey: "message-1",
      raw: "帮助同事写清周报",
      presentedDeliveryId: "delivery_initial",
    };
    const d = (await api.begin(args)) as any;
    assert.equal(d.directive, "host_work");
    assert.equal(d.context.replyWasPresented, true);
    assert.equal(d.context.state, undefined);
    assert.equal(d.context.targets.K01, undefined);
    assert.ok(d.rules.text.includes("01 定义"));
    assert.ok(!d.rules.text.includes("### 7.1"));
    const archived = JSON.parse(readFileSync(d.fullContext.contextRef, "utf8"));
    assert.ok(archived.state.targets.K01);
    assert.equal(d.fullContext.contextDigest, hash(archived));
    const again = (await api.begin({ ...args, knownRulesDigest: d.rules.digest })) as any;
    assert.equal(again.workToken, d.workToken);
    assert.equal(again.rules.unchanged, true);
    assert.equal(again.rules.text, undefined);
    await assert.rejects(() => api.begin({ ...args, raw: "其他原话" }), {
      code: "IDEMPOTENCY_CONFLICT",
    });
    const result = answer(d);
    const finished = (await api.finish({
      sessionId: f.session.id,
      workToken: d.workToken,
      output: result,
    })) as any;
    assert.equal(finished.directive, "deliver");
    assert.equal(f.store.shown(finished.delivery.id), false);
    assert.equal(f.store.pendingInputs(f.session.id).length, 0);
    assert.equal(f.store.load().targets.D01!.answerInputIds.length, 1);
    api.close();
    api = new TurnAPI(f.store);
    const replay = (await api.finish({
      sessionId: f.session.id,
      workToken: d.workToken,
      output: result,
    })) as any;
    assert.deepEqual(replay.receipt, finished.receipt);
    await assert.rejects(
      () =>
        api.finish({
          sessionId: f.session.id,
          workToken: d.workToken,
          output: { ...result, delivery: { text: "换个问题？" } },
        }),
      { code: "IDEMPOTENCY_CONFLICT" },
    );
    const next = (await api.begin({
      sessionId: f.session.id,
      clientKey: "message-2",
      raw: args.raw,
      presentedDeliveryId: finished.delivery.id,
      replyToDeliveryId: finished.delivery.id,
    })) as any;
    assert.notEqual(next.context.input.id, d.context.input.id);
    const old = (await api.begin(args)) as any;
    assert.equal(old.directive, "await_user");
    assert.equal(old.supersededDeliveryId, finished.delivery.id);
    assert.equal(f.store.pendingInputs(f.session.id).length, 1);
    f.store.connect("claude-code", undefined, true);
    await assert.rejects(
      () =>
        api.finish({ sessionId: f.session.id, workToken: next.workToken, output: answer(next) }),
      { code: "SESSION_REPLACED" },
    );
  } finally {
    api.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("finish recovers a committed HEAD after lost response without counting or confirming twice", async () => {
  const f = await fixture();
  let api = new TurnAPI(f.store, () => {
    throw new Error("crash after HEAD");
  });
  try {
    const d = (await api.begin({
      sessionId: f.session.id,
      clientKey: "one",
      raw: "帮助同事写清周报",
      presentedDeliveryId: "delivery_initial",
    })) as any;
    const args = { sessionId: f.session.id, workToken: d.workToken, output: answer(d) };
    await assert.rejects(() => api.finish(args), /crash after HEAD/);
    const revision = f.store.load().revision;
    api.close();
    api = new TurnAPI(f.store);
    const recovered = (await api.finish(args)) as any;
    assert.equal(recovered.directive, "deliver");
    assert.equal(f.store.load().revision, revision);
    assert.equal(f.store.load().targets.D01!.answerInputIds.length, 1);
    const next = (await api.begin({
      sessionId: f.session.id,
      clientKey: "two",
      raw: "同事小林",
      presentedDeliveryId: recovered.delivery.id,
    })) as any;
    assert.equal(next.directive, "host_work");
  } finally {
    api.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("multi-item revision keeps accepted prefix through invalid result and resumes with managed handles", async () => {
  const f = await fixture();
  let api = new TurnAPI(f.store);
  try {
    const d = (await api.begin({
      sessionId: f.session.id,
      clientKey: "revise",
      raw: "把描述改得简短些",
      pipeline: "revision",
    })) as any;
    assert.equal(d.work.kind, "artifact_revision");
    const output: WorkResult = { intent: "revise", delivery: { text: "表达调整已整理。" } };
    const second = (await api.finish({
      sessionId: f.session.id,
      workToken: d.workToken,
      output,
    })) as any;
    assert.equal(second.work.kind, "delivery_compose");
    assert.equal(second.context.previous.length, 1);
    const invalid = { ...output, artifacts: [{ id: "outside" }] } as any;
    await assert.rejects(() =>
      api.finish({ sessionId: f.session.id, workToken: second.workToken, output: invalid }),
    );
    api.close();
    api = new TurnAPI(f.store);
    const resumed = (await api.next(second.requestId, f.session.id)) as any;
    assert.equal(resumed.workToken, second.workToken);
    assert.equal(resumed.context.previous.length, 1);
    const done = (await api.finish({
      sessionId: f.session.id,
      workToken: resumed.workToken,
      output: { ...output, delivery: { text: "描述已调整。你希望搭子帮用户完成哪件具体的事？", questionTargetId: "D01" } },
    })) as any;
    assert.equal(done.directive, "deliver");
    assert.equal(f.store.pendingInputs(f.session.id).length, 0);
  } finally {
    api.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("stage rules preserve method/service requirements and cannot vanish on stage change", () => {
  const methods = stageRules(["methods"]);
  const service = stageRules(["service"]);
  assert.match(methods.text, /四个基础场景/);
  assert.match(methods.text, /三个拓展场景/);
  assert.match(service.text, /智能规划/);
  assert.match(service.text, /四条动线/);
  assert.notEqual(methods.digest, service.digest);
});
