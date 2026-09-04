import type { Delivery, Input, ProjectState, Ref, Stage, WorkResult } from "./types.js";
import type { Store } from "./store.js";
export declare function confirmed(state: ProjectState, objectId: string, decision?: string): boolean;
export declare function bookIds(stage: Stage): string[];
export declare function bookConfirmed(state: ProjectState, stage: Stage): boolean;
export declare function verifyRef(store: Store, state: ProjectState, ref: Ref): void;
export declare function gates(state: ProjectState, store: Store, stage: Stage): {
    label: string;
    pass: boolean;
}[];
export declare function canDraft(state: ProjectState, store: Store, stage: Stage): boolean;
export declare function validateDelivery(result: WorkResult): void;
export declare function continuationOptions(state: ProjectState, store: Store): {
    questionTargets: string[];
    confirmationObjects: string[];
    preparation: string[];
};
export declare function reduce(store: Store, base: ProjectState, input: Input, result: WorkResult, requestId: string): {
    state: ProjectState;
    delivery: Delivery;
    conversationOnly: boolean;
};
