import { Store } from "./store.js";
export type Draft = {
    id: string;
    stepId: string;
    requestId: string;
    epoch: number;
    baseRevision: string;
    sequence: number;
    markdown: string;
    title: string;
    hash: string;
};
export declare function publishDraft(store: Store, sessionId: string, args: {
    stepId: string;
    contextDigest: string;
    sequence: number;
    markdown: string;
    title: string;
}): Draft;
export declare function previewSnapshot(store: Store): {
    buddyId: string;
    revision: string;
    stage: import("./types.js").Stage;
    paused: boolean;
    activity: import("./preview-activity.js").PreviewActivity | null;
    completion: {
        revision: string;
        status: "ready" | "failed";
        message: string;
        fileCount: number | undefined;
        updatedAt: string;
    } | undefined;
    current: {
        stage: import("./types.js").Stage;
        phase: string;
        title: string;
        targetId: string | undefined;
        artifactIds: string[];
        summary: string;
        status: string;
        position: {
            index: number;
            total: number;
        } | undefined;
    };
    stages: {
        id: import("./types.js").Stage;
        number: number;
        title: string;
        current: boolean;
        status: string;
        groups: import("./preview-model.js").PreviewGroup[];
        confirmedChapters: number;
        totalChapters: number;
    }[];
    artifacts: {
        evidence: {
            type: "input" | "artifact" | "source";
            id: string;
            hash: string;
            locator: string | undefined;
            quote: string | undefined;
        }[];
        dependencies: undefined;
        id: string;
        stage: import("./types.js").Stage;
        kind: "chapter" | "hypothesis" | "scenario" | "blueprint" | "transition";
        title: string;
        markdown: string;
        data?: Record<string, unknown>;
        hash: string;
        unresolved: string[];
        revision: string;
        status: import("./preview-model.js").PreviewStatus;
    }[];
    sources: {
        id: string;
        title: string;
        kind: import("./types.js").SourceKind;
        status: "queued" | "running" | "ready" | "failed";
        error: string | undefined;
        version: string;
        warnings: string[];
    }[];
    drafts: (Draft | undefined)[];
    continuation: string | undefined;
};
export declare function servePreview(store: Store, port?: number): Promise<{
    url: string;
    server: import("http").Server<typeof import("http").IncomingMessage, typeof import("http").ServerResponse>;
}>;
export declare function startPreview(store: Store, openBrowser?: boolean): Promise<{
    url: string;
    displayStatus: string;
    readonly: boolean;
    addressPolicy: string;
}>;
export declare function stopPreview(store: Store): Promise<{
    stopped: boolean;
    status: string;
    url: string;
    addressPreserved: boolean;
} | {
    stopped: boolean;
    status: string;
    url?: undefined;
} | {
    stopped: boolean;
    status: string;
    url: string;
}>;
