import { test } from "node:test";
import assert from "node:assert/strict";
import { gates } from "../src/domain.js";
import { SERVICE_RULES } from "../src/rules.js";
import { serviceConversationIssues } from "../src/service-policy.js";
import { serviceDiagram } from "../src/service-diagram.js";
import type { ProjectState } from "../src/types.js";
import type { Store } from "../src/store.js";

const evidence = [{ type: "input", id: "creator-service-choice" }];
function serviceGates(data: Record<string, unknown>) {
  const state = { serviceMode: "smart", artifacts: { "service.blueprint": { data } } } as unknown as ProjectState;
  return Object.fromEntries(gates(state, {} as Store, "service").map((g) => [g.label, g.pass]));
}

test("paid AI conversation quotas are rejected even when real-person consultations have a quota", () => {
  for (const limit of [120, "每月120次", "合理使用", "用完工具额度后不能继续聊", false, null])
    assert.ok(serviceConversationIssues({ conversationLimit: limit, humanConversationLimit: "每周期2次，每次50分钟" }).length);
  assert.deepEqual(serviceConversationIssues({ conversationLimit: "unlimited", humanConversationLimit: "每周期2次，每次50分钟" }), []);
  // An incomplete draft is allowed, but cannot pass the final service contract.
  assert.deepEqual(serviceConversationIssues({}), []);
  assert.equal(serviceGates({})["单档订阅契约"], false);
});

test("maintenance requires actual basic conversation in addition to historical access", () => {
  const base = {
    stages: { maintenance: { service: "历史查看和基础答疑", limit: "付费交付和真人服务暂停" } },
    semanticChecks: { maintenanceBoundary: { pass: true, evidence } },
  };
  assert.equal(serviceGates(base)["停付边界"], false);
  for (const basicConversation of [false, "true", 1])
    assert.ok(serviceConversationIssues({ maintenanceContract: { basicConversation } }).length);
  assert.equal(serviceGates({ ...base, maintenanceContract: { basicConversation: true, allowedQuestions: "日常聊天、普通问题与已有结果解释" } })["停付边界"], true);
});

test("a seven-day free experience with daily follow-up and revisions can pass the free scope gate", () => {
  const data = {
    platformRules: SERVICE_RULES,
    acquisitionContract: { trigger: "第一次使用", requiredInput: "真实日常记录", includedSteps: ["连续7天跟进", "每天答疑", "根据反馈修改方案"],
      completionCriteria: "7天体验结束", excludedSteps: [], conversionBridge: "订阅后持续陪伴与更新" },
    semanticChecks: { freeScopeAgreed: { pass: true, evidence } },
  };
  assert.equal(serviceGates(data)["免费体验范围明确"], true);
  assert.equal(serviceGates({ ...data, semanticChecks: {} })["免费体验范围明确"], false);
  const svg = serviceDiagram(data, "test");
  for (const copy of ["先免费体验", "订阅后持续使用", "暂不订阅，也能基础聊天"])
    assert.ok(svg.includes(copy));
  assert.ok(!svg.includes("免费先交付一次有限"));
});
