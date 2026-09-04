import { test } from "node:test";
import assert from "node:assert/strict";
import { gates } from "../src/domain.js";
import { SERVICE_RULES } from "../src/rules.js";
import { subscriptionPeriod, subscriptionPrice } from "../src/subscription.js";
import { serviceDiagram } from "../src/service-diagram.js";
import { createDefaultServiceBlueprint } from "../preview/ServiceBlueprint.js";
import type { ProjectState } from "../src/types.js";
import type { Store } from "../src/store.js";

function contract(cycle: unknown, extra: Record<string, unknown> = {}) {
  const data = {
    billingCycle: cycle, platformRules: SERVICE_RULES, price: 199,
    multiUser: false, cadence: "每周一次", conversationLimit: "unlimited",
    toolLimit: "每次交付时整理资料", experienceMode: "conversation",
    semanticChecks: { executableContract: { pass: true, evidence: [{ type: "input", id: "actual-choice" }] } },
    ...extra,
  };
  const state = { serviceMode: "smart", artifacts: { "service.blueprint": { data } } } as unknown as ProjectState;
  return gates(state, {} as Store, "service").find((g) => g.label === "单档订阅契约")!.pass;
}

test("subscription periods accept explicit custom durations and keep delivery cadence independent", () => {
  for (const [cycle, priceLabel] of [
    [{ count: 14, unit: "day" }, "¥199 / 14天"],
    [{ count: 8, unit: "week" }, "¥199 / 8周"],
    [{ count: 3, unit: "month" }, "¥199 / 3个月"],
    [{ count: 1, unit: "year" }, "¥199 / 1年"],
  ] as const) {
    assert.equal(contract(cycle), true);
    assert.equal(subscriptionPrice(199, cycle), priceLabel);
    const svg = serviceDiagram({ billingCycle: cycle, price: 199, cadence: "每周一次", deliveries: "约定周期内交付" }, "test");
    assert.ok(svg.includes(priceLabel));
    assert.ok(!svg.includes("月度服务"));
  }
});

test("subscription duration cannot be missing, malformed, or inferred from a weekly delivery schedule", () => {
  for (const cycle of [undefined, null, "weekly", { count: 0, unit: "week" }, { count: -1, unit: "day" },
    { count: 1.5, unit: "month" }, { count: "8", unit: "week" }, { count: 8, unit: "unknown" },
    { count: Infinity, unit: "day" }, { count: 1, unit: "week", until: "unknown" }]) {
    assert.equal(subscriptionPeriod(cycle), undefined);
    assert.equal(contract(cycle), false);
  }
  const defaults = createDefaultServiceBlueprint();
  assert.equal(defaults.billingCycle, undefined);
  assert.equal(defaults.cadence, "");
  assert.equal(defaults.deliveries, "");
  assert.equal(subscriptionPrice("", defaults.billingCycle), "价格待定 / 周期待定");
  assert.ok(!serviceDiagram({}, "test").includes("/月"));
  for (const price of [true, 0, -99, "Infinity", "", null])
    assert.equal(contract({ count: 8, unit: "week" }, { price }), false);
});

test("subscription compatibility retains monthly duration while requiring the current conversation rules", () => {
  assert.equal(contract("monthly"), true);
  assert.deepEqual(subscriptionPeriod("monthly"), { count: 1, unit: "month" });
  assert.equal(subscriptionPrice("99", "monthly"), "¥99 / 1个月");
  assert.equal(contract("monthly", { platformRules: { ...SERVICE_RULES, tiers: 2 } }), false);
  assert.equal(contract({ count: 8, unit: "week" }, { platformRules: { ...SERVICE_RULES,
    paid: { aiConversationLimit: 120 } } }), false);
});
