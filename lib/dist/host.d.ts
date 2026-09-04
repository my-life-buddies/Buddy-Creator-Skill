export type Host = "codex" | "claude-code" | "workbuddy";
export interface HostDetection {
    host: Host;
    source: "argument" | "process" | "environment";
    evidence: string[];
}
export declare function ancestorExecutables(): string[];
export declare function detectHost(explicit?: string, env?: NodeJS.ProcessEnv, ancestors?: string[]): HostDetection;
