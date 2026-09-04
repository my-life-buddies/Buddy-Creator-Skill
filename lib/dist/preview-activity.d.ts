import type { Store } from "./store.js";
import type { Draft } from "./preview.js";
import type { ProjectState, Session, SourceManifest } from "./types.js";
export type PreviewActivity = {
    mode: "working" | "waiting" | "ready" | "paused" | "attention";
    label: string;
    detail?: string;
};
export declare function previewActivity(store: Store, state: ProjectState, session: Session | undefined, accepted: Set<string>, drafts: Draft[], sources: SourceManifest[], time?: number): PreviewActivity | null;
