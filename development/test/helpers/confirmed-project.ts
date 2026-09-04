import { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handoffStatus } from "../../src/handoff.js";
import { hash } from "../../src/io.js";
import { CARDS, CHAPTERS, SERVICE_RULES, STAGES } from "../../src/rules.js";
import { enqueueSource, processSource } from "../../src/sources.js";
import { openWorkspace, type Store } from "../../src/store.js";
import type { Artifact, ProjectState, Ref, Stage } from "../../src/types.js";
export async function fixture(t: TestContext, complete = true) {
  const root = mkdtempSync(join(tmpdir(), "buddy-coding-handoff-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = await openWorkspace("handoff-coach", { home: join(root, "registry"), root: join(root, "projects") });
  const session = store.connect("test");
  if (!complete) return { root, store, session };

  // Seed a confirmed unit fixture; full-interview.test.ts covers acquiring each real confirmation.
  const ticket = store.reserve(session.id, "confirmed-fixture");
  const input = store.record(session.id, ticket.token, "确认这套写作搭子的定义、知识、方法和服务方案。");
  const evidence: Ref[] = [{ type: "input", id: input.id, hash: input.hash, quote: input.raw }];
  const sourceJob = enqueueSource(store, { operationId: "handoff-source", kind: "oral", text: "先理解真实工作记录，再帮助用户整理表达；不编造经历。" });
  const source = await processSource(store, sourceJob.id);
  assert.equal(source.status, "ready");
  const state = store.load();
  state.stage = "service";
  state.serviceMode = "smart";
  state.serviceModelExplained = true;
  for (const target of Object.values(state.targets)) target.status = "sufficient";
  state.answeredInputs = [input.id];
  state.sourcePlan = { requiredKinds: ["oral"], sourceIds: [source.id], discoveryClosed: true };
  state.sources = { [source.id]: { version: source.version, kind: source.kind } };
  const deliveryId = "delivery-confirmed-fixture";
  function artifact(id: string, stage: Stage, kind: Artifact["kind"], title: string, data?: Record<string, unknown>) {
    const markdown = `${title}：以用户的真实工作记录为依据。`;
    const item: Artifact = { id, stage, kind, title, markdown, hash: hash({ id, markdown, data }), data,
      evidence, dependencies: [], unresolved: [], revision: "" };
    state.artifacts[id] = item;
    state.confirmations.push({ id: `confirmation-${id}`, objectId: id, hash: item.hash,
      inputId: input.id, deliveryId, decision: kind === "hypothesis" ? "accepted" : "confirmed", evidence });
  }
  for (const stage of STAGES)
    CHAPTERS[stage].forEach((title, index) => artifact(`${stage}.${index + 1}`, stage, "chapter", title));
  for (let index = 1; index <= 3; index++) artifact(`hypothesis.H${index}`, "methods", "hypothesis", `方法 ${index}`);
  for (const id of ["M01", "M02", "M03", "M04", "E01", "E02", "E03"])
    artifact(`scenario.${id}`, "methods", "scenario", CARDS[id]!.title);
  artifact("service.blueprint", "service", "blueprint", "服务蓝图", {
    platformRules: SERVICE_RULES, multiUser: false, billingCycle: { count: 8, unit: "week" }, price: 199,
    valueStatement: "每周根据真实进展调整表达", recurrenceDrivers: ["每周产生新记录"], renewalEvidence: ["表达更清楚"],
    serviceLoop: { trigger: "每周复盘", requiredInput: "工作记录", decision: "判断重点", action: "整理表达",
      result: "重点卡片", feedback: "使用困难", nextCycleUpdate: "根据反馈调整" },
    acquisitionContract: { trigger: "首次使用", requiredInput: "真实记录", includedSteps: ["澄清", "完成重点卡"],
      excludedSteps: [], completionCriteria: "重点卡完成", conversionBridge: "订阅后继续复盘" },
    stages: {
      acquisition: { id: "acquisition", title: "获客期", goal: "体验整理方法", result: "重点卡", service: "澄清与整理", limit: "免费体验7天" },
      paid: { id: "paid", title: "付费期", goal: "持续改善表达", result: "每周重点卡", service: "按反馈持续复盘", limit: "真人服务不包含" },
      maintenance: { id: "maintenance", title: "维持期", goal: "保留基础能力", result: "历史与基础答疑", service: "基础对话与历史查看", limit: "新付费结果暂停" },
    },
    transitions: Object.fromEntries(["acquisition-paid", "acquisition-maintenance", "paid-paid", "paid-maintenance", "maintenance-paid"]
      .map((id) => [id, { id, trigger: "用户选择，到期后生效", rightsChange: "按选择调整权益", dataInheritance: "保留历史", message: "之后仍可继续" }])),
    semanticChecks: Object.fromEntries(["coherentLoop", "paidDeliverable", "freeScopeAgreed", "maintenanceBoundary", "transitionsConfirmed",
      "valueBeforePaywall", "executableContract"].map((key) => [key, { pass: true, evidence }])),
    cadence: "每周", deliveries: "每周一张重点卡", conversationLimit: "unlimited", humanReview: false,
    maintenanceContract: { basicConversation: true, allowedQuestions: "日常交流与已有结果解释" },
    toolLimit: "仅在整理结果时使用", experienceMode: "conversation",
  });
  store.commit(state.revision, state, { id: deliveryId, requestId: "fixture", revision: state.revision,
    text: "四册方案已确认。", hash: hash("四册方案已确认。"), kind: "content", inputId: input.id },
  "confirm-fixture", "confirm-fixture", hash(state));
  assert.equal(handoffStatus(store).ready, true);
  return { root, store, session };
}

export function revision(store: Store, update: (state: ProjectState) => void, operationId: string) {
  const state = store.load();
  update(state);
  store.commit(state.revision, state, { id: `delivery-${operationId}`, requestId: operationId,
    revision: state.revision, text: "fixture update", hash: hash(operationId), kind: "content" },
  operationId, operationId, hash(state));
}

