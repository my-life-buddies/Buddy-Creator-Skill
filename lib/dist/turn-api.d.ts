import { Workflow } from "./workflow.js";
import type { Store } from "./store.js";
import type { Input, WorkResult, Stage } from "./types.js";
type Begin = {
    sessionId: string;
    clientKey: string;
    raw: string;
    replyToDeliveryId?: string;
    presentedDeliveryId?: string;
    annotation?: Input["annotation"];
    pipeline?: "interview" | "knowledge" | "revision";
    conflictReview?: {
        objectIds: string[];
        reason: string;
    };
    knownRulesDigest?: string;
};
export declare function stageRules(stages: Stage[]): {
    digest: string;
    text: string;
    fullRulebookRef: string;
};
export declare function compactWork(store: Store, directive: Record<string, any>, sessionId: string, knownRulesDigest?: string): Record<string, any>;
export declare class TurnAPI {
    store: Store;
    workflow: Workflow;
    constructor(store: Store, afterHead?: () => void);
    close(): void;
    next(requestId: string, sessionId: string, knownRulesDigest?: string): Promise<Record<string, any>>;
    begin(args: Begin): Promise<Record<string, any>>;
    finish(args: {
        sessionId: string;
        workToken: string;
        output: WorkResult;
        knownRulesDigest?: string;
    }): Promise<Record<string, any>>;
}
export {};
