export const SUBSCRIPTION_UNITS = ["day", "week", "month", "year"] as const;
export type SubscriptionPeriod = { count: number; unit: typeof SUBSCRIPTION_UNITS[number] };
export type BillingCycle = SubscriptionPeriod | "monthly";

// Read legacy monthly plans without rewriting their content or confirmation hashes.
export function subscriptionPeriod(value: unknown): SubscriptionPeriod | undefined {
  if (value === "monthly") return { count: 1, unit: "month" };
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const period = value as Record<string, unknown>;
  if (Object.keys(period).some((key) => key !== "count" && key !== "unit") ||
    typeof period.count !== "number" || !Number.isSafeInteger(period.count) || period.count <= 0 ||
    !SUBSCRIPTION_UNITS.includes(period.unit as SubscriptionPeriod["unit"])) return;
  return { count: period.count, unit: period.unit as SubscriptionPeriod["unit"] };
}

export function subscriptionLabel(value: unknown) {
  const period = subscriptionPeriod(value);
  return period ? `${period.count}${{ day: "天", week: "周", month: "个月", year: "年" }[period.unit]}` : "周期待定";
}

export function subscriptionPrice(price: unknown, cycle: unknown) {
  const amount = typeof price === "number" || typeof price === "string" && price.trim() ? Number(price) : NaN;
  const label = Number.isFinite(amount) && amount > 0 ? `¥${amount}` : "价格待定";
  return `${label} / ${subscriptionLabel(cycle)}`;
}
