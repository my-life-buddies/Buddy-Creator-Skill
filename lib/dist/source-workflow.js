import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { mkdirSync } from "node:fs";
import { SqliteSaver } from "./checkpoints.js";
import { BuddyError, check, immutable, withLock } from "./io.js";
import { assertSourceSupported } from "./source-policy.js";
import { processSource } from "./sources.js";
const SourceFlow = Annotation.Root({
    sourceId: Annotation(),
    version: Annotation(),
});
/** A durable tool job. Host sessions can end while acquisition/recognition continues. */
export class SourceWorkflow {
    store;
    afterSourceSaved;
    saver;
    graph;
    constructor(store, afterSourceSaved) {
        this.store = store;
        this.afterSourceSaved = afterSourceSaved;
        mkdirSync(store.path("runtime-work"), { recursive: true, mode: 0o700 });
        immutable(store.path("runtime-work", "source-format.json"), {
            workflowVersion: "1",
            langgraph: "1.4.13",
            checkpointSchema: "sqlite-1.0.4",
        });
        this.saver = SqliteSaver.fromConnString(store.path("runtime-work", "checkpoints.sqlite"));
        this.graph = new StateGraph(SourceFlow)
            .addNode("source_process", async ({ sourceId }) => {
            const source = await processSource(store, sourceId);
            this.afterSourceSaved?.();
            if (source.status !== "ready")
                throw new BuddyError("SOURCE_PROCESS_FAILED", source.error ?? "资料处理未完成。", { sourceId, jobId: source.jobId, version: source.version });
            return { version: source.version };
        })
            .addEdge(START, "source_process")
            .addEdge("source_process", END)
            .compile({ checkpointer: this.saver });
    }
    close() {
        this.saver.db.close();
    }
    async run(sourceId) {
        const source = this.store.source(sourceId);
        if (source.status === "ready" && source.kind === "xiaohongshu")
            return source;
        assertSourceSupported(source.kind);
        const config = {
            configurable: {
                thread_id: `source:${this.store.load().workspaceId}:${source.jobId}`,
            },
        };
        return withLock(this.store.path("source-jobs", "workflow-locks", sourceId), async () => {
            let saved = await this.graph.getState(config);
            if (saved.values.sourceId) {
                check(saved.values.sourceId === sourceId, "SOURCE_WORK_IDENTITY", "资料检查点与当前任务不一致。");
                if (saved.next.length)
                    await this.graph.invoke(null, config);
            }
            else
                await this.graph.invoke({ sourceId }, config);
            saved = await this.graph.getState(config);
            const complete = this.store.source(sourceId, saved.values.version);
            check(complete.status === "ready" && !saved.next.length, "SOURCE_WORK_INCOMPLETE", "资料工作还未完成，已保留进度。");
            return complete;
        });
    }
}
