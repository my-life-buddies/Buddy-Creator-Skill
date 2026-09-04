import { SqliteSaver } from "./checkpoints.js";
import type { Store } from "./store.js";
import type { Turn, WorkEnvelope } from "./types.js";
export declare class Workflow {
    store: Store;
    afterHead?: (() => void) | undefined;
    saver: SqliteSaver;
    graph: ReturnType<ReturnType<Workflow["builder"]>["compile"]>;
    constructor(store: Store, afterHead?: (() => void) | undefined);
    close(): void;
    private builder;
    private currentSession;
    private guard;
    turn(requestId: string): Turn;
    prepare(sessionId: string, inputId: string, pipeline?: "interview" | "knowledge" | "revision", conflictReview?: {
        objectIds: string[];
        reason: string;
    }): Promise<Record<string, unknown>>;
    private prepareItem;
    next(requestId: string, autoFinalize?: boolean): Promise<Record<string, unknown>>;
    private merge;
    complete(requestId: string, envelope: WorkEnvelope): Promise<Record<string, unknown>>;
    private commitResults;
    commit(requestId: string, operationId: string): Promise<Record<string, unknown>>;
    retry(requestId: string): Promise<Record<string, unknown>>;
    cancel(sessionId: string): {
        directive: string;
        cancelledRequestId: string | undefined;
    };
    pause(sessionId: string, paused: boolean): {
        directive: string;
        paused: boolean;
    };
}
