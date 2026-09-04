import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWorkspace } from "../src/store.js";
import { TurnAPI } from "../src/turn-api.js";
import { bookIds, confirmed, continuationOptions, reduce } from "../src/domain.js";
import { hash } from "../src/io.js";
import type { Artifact, Input, ProjectState, Stage, WorkResult } from "../src/types.js";

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "buddy-continuation-"));
  const store = await openWorkspace("continuation", { home: join(root, "registry"), root: join(root, "projects") });
  const session = store.connect("test");
  let sequence = 0;
  return {
    store, session,
    input: (raw: string, replyToDeliveryId?: string) => store.record(session.id,
      store.reserve(session.id, `message-${++sequence}`, replyToDeliveryId).token, raw),
    close: () => rmSync(root, { force: true, recursive: true }),
  };
}
const ref = (i: Input) => ({ type: "input" as const, id: i.id, hash: i.hash, quote: i.raw });
function artifact(state: ProjectState, stage: Stage, id: string, kind: Artifact["kind"]): Artifact {
  return { id, kind, stage, title: id, markdown: `当前内容 ${id}`, hash: hash(id),
    dependencies: [], evidence: [], unresolved: [], revision: state.revision };
}
function methodsState(state: ProjectState) {
  state.stage = "methods";
  for (const stage of ["definition", "knowledge"] as const)
    for (const id of bookIds(stage)) {
      const a = state.artifacts[id] = artifact(state, stage, id, "chapter");
      state.confirmations.push({ id: `confirmed-${id}`, objectId: id, hash: a.hash,
        inputId: "fixture", deliveryId: "fixture", decision: "confirmed", evidence: [] });
    }
  for (let n = 1; n <= 3; n++) {
    const id = `hypothesis.H${n}`;
    const a = state.artifacts[id] = artifact(state, "methods", id, "hypothesis");
    const t = state.targets[`H0${n}`]!;
    t.status = "sufficient";
    t.answerInputIds = [`answer-${n}-1`, `answer-${n}-2`];
    if (n > 1) state.confirmations.push({ id: `accepted-${id}`, objectId: id, hash: a.hash,
      inputId: "fixture", deliveryId: "fixture", decision: "accepted", evidence: [] });
  }
  return state;
}

test("acknowledgment-only finish fails before commit; repairing the same turn advances once", async () => {
  const f = await fixture(), api = new TurnAPI(f.store);
  try {
    const d = await api.begin({ sessionId: f.session.id, clientKey: "one", raw: "帮同事写周报" }) as any;
    assert.ok(d.context.continuation.questionTargets.includes("D01"));
    const output: WorkResult = { intent: "supplement", assessments: [{ targetId: "D01", status: "sufficient",
      summary: "帮助同事写周报", gaps: [], evidence: [ref(d.context.input)] }],
      delivery: { text: "好的，按这版保留。" } };
    const before = f.store.load().revision;
    await assert.rejects(() => api.finish({ sessionId: f.session.id, workToken: d.workToken, output }),
      (e: any) => e.code === "NEXT_ACTION_REQUIRED" && e.details.questionTargets.includes("D02"));
    assert.equal(f.store.load().revision, before);
    assert.equal(f.store.pendingInputs(f.session.id).length, 1);
    const repaired = { ...output, delivery: { text: "写周报这个方向已记下。你最先想到帮助哪位同事？", questionTargetId: "D02" } };
    const done = await api.finish({ sessionId: f.session.id, workToken: d.workToken, output: repaired }) as any;
    assert.equal(done.delivery.question.targetId, "D02");
    assert.equal(f.store.pendingInputs(f.session.id).length, 0);
    const replay = await api.finish({ sessionId: f.session.id, workToken: d.workToken, output: repaired }) as any;
    assert.deepEqual(replay.receipt, done.receipt);
  } finally { api.close(); f.close(); }
});

test("sufficient candidate can be ratified at its cap; acceptance still needs the shown current version", async () => {
  const f = await fixture();
  try {
    const state = methodsState(f.store.load()), input = f.input("继续");
    const before = structuredClone(state);
    const request: WorkResult = { intent: "supplement", delivery: {
      text: "第一条的完整表述已整理。这版准确吗？", confirmationObjectIds: ["hypothesis.H1"] } };
    const shown = reduce(f.store, state, input, request, "show-current");
    assert.equal(shown.delivery.question, undefined);
    assert.deepEqual(shown.state.targets.H01, before.targets.H01);
    assert.deepEqual(shown.state.confirmations, before.confirmations);
    assert.deepEqual(state, before);
    assert.throws(() => reduce(f.store, state, input, { intent: "supplement", delivery: {
      text: "第一次求助时先问什么？", questionTargetId: "M01" } }, "early"), { code: "METHOD_HYPOTHESES" });
    assert.throws(() => reduce(f.store, state, input, { intent: "supplement", delivery: {
      text: "再详细讲讲第一条？", questionTargetId: "H01" } }, "followup"), { code: "FOLLOWUP_CLOSED" });

    f.store.commit(state.revision, shown.state, shown.delivery, "show-current", "show-current", hash(request));
    shown.state = f.store.load();
    shown.delivery = f.store.delivery(shown.delivery.id);
    f.store.presentation(shown.delivery.id, "host_reported");
    const yes = f.input("准确", shown.delivery.id);
    const confirm: WorkResult = { intent: "confirm", confirmation: {
      target: shown.delivery.confirmationTarget!, decision: "accepted", evidence: [ref(yes)] },
      delivery: { text: "三条方法已确认。第一次求助时，你会先了解什么？", questionTargetId: "M01" } };
    const unshown = Object.create(f.store);
    unshown.shown = () => false;
    assert.throws(() => reduce(unshown, shown.state, yes, confirm, "unshown"), { code: "CONFIRMATION_NOT_SHOWN" });
    const unbound = Object.create(f.store);
    unbound.delivery = () => ({ ...shown.delivery, confirmationTarget: undefined });
    assert.throws(() => reduce(unbound, shown.state, yes, confirm, "unbound"), { code: "CONFIRMATION_NOT_SHOWN" });
    const stale = structuredClone(shown.state);
    stale.artifacts["hypothesis.H1"]!.hash = hash("changed");
    assert.throws(() => reduce(f.store, stale, yes, confirm, "stale"), { code: "CONFIRMATION_STALE" });
    assert.throws(() => reduce(f.store, shown.state, yes, { ...confirm, delivery: { text: "好的，已保留。" } }, "stop"),
      { code: "NEXT_ACTION_REQUIRED" });
    const accepted = reduce(f.store, shown.state, yes, confirm, "accepted");
    assert.ok(confirmed(accepted.state, "hypothesis.H1", "accepted"));
    assert.equal(accepted.delivery.question?.targetId, "M01");
    assert.deepEqual(accepted.state.targets.H01!.answerInputIds, before.targets.H01!.answerInputIds);
    assert.throws(() => reduce(f.store, accepted.state, yes, request, "repeat"), { code: "HYPOTHESIS_HANDLED" });

    for (const status of ["uncertain", "skipped", "exhausted", "partial"] as const) {
      const closed = structuredClone(state); closed.targets.H01!.status = status;
      assert.throws(() => reduce(f.store, closed, input, request, status), { code: "FOLLOWUP_CLOSED" });
    }
    const pending = structuredClone(state); pending.artifacts["hypothesis.H1"]!.unresolved.push("待核实依据");
    assert.throws(() => reduce(f.store, pending, input, request, "pending"), { code: "HYPOTHESIS_UNRESOLVED" });
  } finally { f.close(); }
});

test("stage handoff requires the first question or preparation, while pauses, explanations and real blockers can stop", async () => {
  const f = await fixture();
  try {
    const state = methodsState(f.store.load()), input = f.input("确认这份知识手册");
    for (const id of ["hypothesis.H1", "hypothesis.H2", "hypothesis.H3"]) delete state.artifacts[id];
    assert.deepEqual(continuationOptions(state, f.store).preparation, ["method_hypotheses"]);
    assert.throws(() => reduce(f.store, state, input, { intent: "supplement", delivery: { text: "接下来进入方法梳理。" } }, "handoff"),
      { code: "NEXT_ACTION_REQUIRED" });
    assert.equal(reduce(f.store, state, input, { intent: "pause", delivery: { text: "已暂停，下次从这里继续。" } }, "pause").state.paused, true);
    const explanation = "先校准方法，是为了确认我从资料里整理出的判断顺序是否符合你的实际做法。文件中的一句话可能省略了适用条件，所以这里仍保留为候选，不把它自动当作你认可的规则。暂时没有想清楚也可以保留，已经确认的定位和知识手册不会因此被重新采访。";
    assert.equal(reduce(f.store, state, input, { intent: "explain", delivery: { text: explanation } }, "explain").conversationOnly, true);
    const blocked = methodsState(f.store.load());
    blocked.confirmations = blocked.confirmations.filter((c) => !c.objectId.startsWith("hypothesis."));
    for (const id of ["H01", "H02", "H03"]) blocked.targets[id]!.status = "uncertain";
    assert.deepEqual(continuationOptions(blocked, f.store), { questionTargets: [], confirmationObjects: [], preparation: [] });
    reduce(f.store, blocked, input, { intent: "supplement", delivery: { text: "三条方法仍未确定，暂不能进入案例。现有内容已保留；有新的实际做法后可从对应候选恢复。" } }, "blocked");
  } finally { f.close(); }
});
