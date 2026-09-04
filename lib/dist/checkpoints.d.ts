import { DatabaseSync } from "node:sqlite";
import { BaseCheckpointSaver, type Checkpoint, type CheckpointListOptions, type CheckpointMetadata, type CheckpointTuple, type PendingWrite, type SerializerProtocol } from "@langchain/langgraph-checkpoint";
type Config = Parameters<BaseCheckpointSaver["getTuple"]>[0];
export declare class SqliteSaver extends BaseCheckpointSaver {
    db: DatabaseSync;
    constructor(db: DatabaseSync, serde?: SerializerProtocol);
    static fromConnString(path: string): SqliteSaver;
    private transaction;
    private tuple;
    getTuple(config: Config): Promise<CheckpointTuple | undefined>;
    list(config: Config, options?: CheckpointListOptions): AsyncGenerator<CheckpointTuple, void, unknown>;
    put(config: Config, checkpoint: Checkpoint, metadata: CheckpointMetadata): Promise<{
        configurable: {
            thread_id: any;
            checkpoint_ns: any;
            checkpoint_id: string;
        };
    }>;
    putWrites(config: Config, writes: PendingWrite[], taskId: string): Promise<void>;
    deleteThread(threadId: string): Promise<void>;
}
export {};
