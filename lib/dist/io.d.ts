export declare class BuddyError extends Error {
    code: string;
    details?: unknown | undefined;
    constructor(code: string, message: string, details?: unknown | undefined);
}
export declare function check(value: unknown, code: string, message: string, details?: unknown): asserts value;
export declare function canonical(value: unknown): string;
export declare const hash: (value: unknown) => string;
export declare const id: (prefix: string) => string;
export declare const now: () => string;
export declare function safeId(value: string): string;
export declare function read<T>(path: string): T;
export declare function optional<T>(path: string): T | undefined;
export declare function syncDir(path: string): void;
export declare function atomic(path: string, data: string | Buffer): void;
export declare function json(path: string, value: unknown): void;
export declare function immutable(path: string, value: unknown): void;
export declare function withLock<T>(directory: string, fn: () => T | Promise<T>): Promise<T>;
export declare function jsonFiles<T>(directory: string): T[];
