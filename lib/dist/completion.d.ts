import type { Store } from "./store.js";
type CompletionRecord = {
    version: 1;
    buddyId: string;
    revision: string;
    status: "ready" | "failed";
    createdAt: string;
    updatedAt: string;
    manifestHash?: string;
    fileCount?: number;
    error?: string;
};
/** The CLI holds the project lock; this lock also protects direct concurrent finalizers. */
export declare function ensureCompletion(store: Store): Promise<CompletionRecord | undefined>;
/** The preview receives a projection without local filesystem paths. */
export declare function completionSnapshot(store: Store): {
    revision: string;
    status: "ready" | "failed";
    message: string;
    fileCount: number | undefined;
    updatedAt: string;
} | undefined;
export declare function withCompletion(store: Store, directive: Record<string, unknown>): Promise<Record<string, unknown>>;
export {};
