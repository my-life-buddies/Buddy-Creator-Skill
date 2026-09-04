import type { SourceKind, SourceManifest } from "./types.js";
import type { Store } from "./store.js";
export type SourceRequest = {
    operationId: string;
    kind: SourceKind;
    uri?: string;
    title?: string;
    text?: string;
    locale?: string;
    limit?: number;
};
export type Part = {
    text: string;
    locator: string;
};
export declare function run(program: string, args: string[], timeout?: number): Promise<string>;
export declare function chunkParts(parts: Part[]): SourceManifest["chunks"];
export declare function parseHistory(text: string): Part[];
export declare function nativeMedia(store: Store, command: "ocr" | "transcribe", path: string, locale?: string): Promise<Part[]>;
export declare function readableWeb(url: string): Promise<{
    parts: Part[];
    original: Buffer;
    title: string;
}>;
export declare function enqueueSource(store: Store, request: SourceRequest): SourceManifest;
export declare function processSource(store: Store, sourceId: string): Promise<SourceManifest>;
