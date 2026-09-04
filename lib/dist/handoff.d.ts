import type { Store } from "./store.js";
import type { ProjectState } from "./types.js";
export declare function handoffStatus(store: Store, state?: ProjectState): {
    revision: string;
    ready: boolean;
    stages: {
        stage: import("./types.js").Stage;
        bookletConfirmed: boolean;
        gates: {
            label: string;
            pass: boolean;
        }[];
    }[];
};
export declare function collectDeliverables(store: Store, state?: ProjectState): {
    files: Record<string, Uint8Array<ArrayBufferLike>>;
    manifest: {
        buddyId: string;
        revision: string;
        complete: boolean;
        files: {
            path: string;
            bytes: number;
            sha256: string;
        }[];
    };
};
/** Optional explicit export. Normal completion writes a local directory, never a ZIP. */
export declare function exportHandoff(store: Store, operationId: string, options?: {
    revision?: string;
}): {
    operationId: string;
    revision: string;
    path: string;
    bytes: number;
    sha256: string;
    fileCount: number;
};
