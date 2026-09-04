import type { SourceManifest } from "./types.js";
export declare const sourcePolicy: {
    version: number;
    supportedKinds: readonly ["file", "webpage", "history", "mindmap", "skill", "oral", "scan", "audio", "video"];
    hostProcessedKinds: string[];
    mediaRecovery: string;
    legacyReadOnlyKinds: string[];
    recovery: string;
};
export declare function isHostMedia(kind: string): boolean;
export declare function sourceNeedsHostResult(source: SourceManifest): boolean;
export declare function assertSourceSupported(kind: string): void;
export declare function assertWebSourceSupported(uri: string): void;
/** Read-only projection: never rewrite archived manifests or source-plan decisions on upgrade. */
export declare function sourceView(source: SourceManifest): SourceManifest;
