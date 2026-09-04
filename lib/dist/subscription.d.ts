export declare const SUBSCRIPTION_UNITS: readonly ["day", "week", "month", "year"];
export type SubscriptionPeriod = {
    count: number;
    unit: typeof SUBSCRIPTION_UNITS[number];
};
export type BillingCycle = SubscriptionPeriod | "monthly";
export declare function subscriptionPeriod(value: unknown): SubscriptionPeriod | undefined;
export declare function subscriptionLabel(value: unknown): string;
export declare function subscriptionPrice(price: unknown, cycle: unknown): string;
