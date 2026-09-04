import { SqliteSaver } from "./checkpoints.js";
import type { SourceManifest } from "./types.js";
import type { Store } from "./store.js";
/** A durable tool job. Host sessions can end while acquisition/recognition continues. */
export declare class SourceWorkflow {
    private store;
    private afterSourceSaved?;
    readonly saver: SqliteSaver;
    readonly graph: import("@langchain/langgraph").CompiledStateGraph<{
        sourceId: string;
        version: string;
    }, {
        sourceId?: string | undefined;
        version?: string | undefined;
    }, "source_process" | "__start__", {
        sourceId: import("@langchain/langgraph").LastValue<string>;
        version: import("@langchain/langgraph").LastValue<string>;
    }, {
        sourceId: import("@langchain/langgraph").LastValue<string>;
        version: import("@langchain/langgraph").LastValue<string>;
    }, import("@langchain/langgraph").StateDefinition, {
        source_process: {
            version: string;
        };
    }, unknown, unknown, []>;
    constructor(store: Store, afterSourceSaved?: (() => void) | undefined);
    close(): void;
    run(sourceId: string): Promise<SourceManifest>;
}
