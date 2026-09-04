import type { Artifact, Delivery, ProjectState, Stage } from "./types.js";
export type PreviewStatus = "confirmed" | "accepted" | "rejected" | "pending" | "revised";
export type PreviewArtifact = Artifact & {
    status: PreviewStatus;
};
export type PreviewTopic = {
    id: string;
    title: string;
    summary: string;
    status: string;
    artifactId?: string;
    current: boolean;
};
export type PreviewGroup = {
    id: string;
    title: string;
    topics: PreviewTopic[];
};
export declare const previewLabels: Record<PreviewStatus, string>;
export declare function artifactStatus(state: ProjectState, id: string): PreviewStatus;
/** Read-only projection: business confirmation remains governed by domain.ts. */
export declare function projectPreview(state: ProjectState, delivery?: Delivery): {
    current: {
        stage: Stage;
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
        id: Stage;
        number: number;
        title: string;
        current: boolean;
        status: string;
        groups: PreviewGroup[];
        confirmedChapters: number;
        totalChapters: number;
    }[];
    artifacts: PreviewArtifact[];
};
