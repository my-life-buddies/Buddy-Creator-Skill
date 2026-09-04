import { test } from "node:test";
import assert from "node:assert/strict";
import { projectPreview } from "../src/preview-model.js";
import { CARDS, CHAPTERS } from "../src/rules.js";
import type { Artifact, Delivery, ProjectState } from "../src/types.js";

function fixture(): ProjectState {
  return {
    schemaVersion: 1, rulesVersion: "1.9", buddyId: "preview-test", workspaceId: "preview-test", revision: "rev1", stage: "methods", paused: false,
    targets: Object.fromEntries(Object.keys(CARDS).map((id) => [id, { id, cycleId: "cycle1", status: "unstarted", summary: "", answerInputIds: [], gaps: [], evidence: [] }])),
    cycles: [], artifacts: {}, confirmations: [], sourcePlan: { requiredKinds: [], sourceIds: [], discoveryClosed: false }, sources: {}, serviceModelExplained: false, answeredInputs: [],
  };
}
function artifact(state: ProjectState, id: string, kind: Artifact["kind"], stage = state.stage) {
  return state.artifacts[id] = { id, kind, stage, title: id, markdown: `内容 ${id}`, hash: `hash-${id}`, revision: state.revision, evidence: [], dependencies: [], unresolved: [] };
}
function confirm(state: ProjectState, id: string, decision: "confirmed" | "accepted" | "rejected" = "confirmed") {
  state.confirmations.push({ id: `confirm-${id}`, objectId: id, hash: state.artifacts[id]!.hash, inputId: "input1", deliveryId: "delivery1", decision, evidence: [] });
}
function delivery(targetId: string): Delivery {
  return { id: "delivery1", requestId: "request1", revision: "rev1", text: "采访中的当前问题", hash: "delivery-hash", kind: "content", question: { id: "q1", targetId, cycleId: "cycle1", mode: "ordinary" } };
}

test("current method candidate precedes future scenarios and adoption is distinct from booklet confirmation", () => {
  const state = fixture();
  for (const id of ["H1", "H2", "H3"]) artifact(state, `hypothesis.${id}`, "hypothesis");
  confirm(state, "hypothesis.H1", "accepted");
  const view = projectPreview(state, delivery("H02"));
  assert.deepEqual(view.current.artifactIds, ["hypothesis.H2"]);
  assert.deepEqual(view.current.position, { index: 2, total: 3 });
  assert.equal(view.current.phase, "候选校准");
  assert.equal(view.artifacts[0]!.status, "accepted");
  assert.equal(view.stages[2]!.status, "进行中");
  assert.equal(view.stages[2]!.groups[0]!.topics.length, 3);
  assert.equal(view.stages[2]!.groups[1]!.topics.length, 4);
  assert.equal(view.stages[2]!.groups[2]!.topics.length, 3);
});

test("partial book retains its full chapter outline and stale confirmations are visibly invalidated", () => {
  const state = fixture(); state.stage = "definition";
  artifact(state, "definition.1", "chapter"); confirm(state, "definition.1");
  let view = projectPreview(state, delivery("D02"));
  assert.equal(view.stages[0]!.groups.at(-1)!.topics.length, 6);
  assert.equal(view.stages[0]!.confirmedChapters, 1);
  assert.notEqual(view.stages[0]!.status, "已确认");
  state.artifacts["definition.1"]!.hash = "new-version";
  view = projectPreview(state, delivery("D01"));
  assert.equal(view.artifacts[0]!.status, "revised");
  assert.equal(view.stages[0]!.confirmedChapters, 0);
  assert.equal(view.stages[0]!.status, "待重新确认");
});

test("progress does not reuse a stale delivery from the preceding stage or invent a fourth candidate", () => {
  const state = fixture();
  for (let i = 1; i <= CHAPTERS.definition.length; i++) { artifact(state, `definition.${i}`, "chapter", "definition"); confirm(state, `definition.${i}`); }
  const view = projectPreview(state, delivery("D06"));
  assert.equal(view.stages[0]!.status, "已确认");
  assert.equal(view.current.phase, "候选校准");
  assert.equal(view.current.title, "整理方法候选");
  assert.equal(view.current.targetId, undefined);
  assert.equal(view.stages[2]!.groups[0]!.topics.length, 0);
});

test("service transition focus is named for creators and all five paths remain accessible", () => {
  const state = fixture(); state.stage = "service";
  const view = projectPreview(state, delivery("T.paid-maintenance.2"));
  assert.equal(view.current.phase, "用户路径");
  assert.equal(view.current.title, "停止续费 / 权益");
  const paths = view.stages[3]!.groups.find((g) => g.id === "paths")!.topics;
  assert.equal(paths.length, 5);
  assert.equal(paths.at(-1)!.status, "系统固定");
  assert.equal(paths.find((p) => p.id === "path.paid-maintenance")!.current, true);
});
