import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync, } from "node:fs";
import { dirname, join } from "node:path";
export class BuddyError extends Error {
    code;
    details;
    constructor(code, message, details) {
        super(message);
        this.code = code;
        this.details = details;
        this.name = "BuddyError";
    }
}
export function check(value, code, message, details) {
    if (!value)
        throw new BuddyError(code, message, details);
}
export function canonical(value) {
    if (value === undefined)
        return "null";
    if (Array.isArray(value))
        return `[${value.map(canonical).join(",")}]`;
    if (value !== null && typeof value === "object")
        return `{${Object.entries(value)
            .filter(([, v]) => v !== undefined)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
            .join(",")}}`;
    return JSON.stringify(value);
}
export const hash = (value) => createHash("sha256")
    .update(typeof value === "string" || Buffer.isBuffer(value)
    ? value
    : canonical(value))
    .digest("hex");
export const id = (prefix) => `${prefix}_${randomUUID()}`;
export const now = () => new Date().toISOString();
export function safeId(value) {
    check(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,150}$/.test(value) && value !== "..", "INVALID_ID", "标识只能包含字母、数字、下划线、点和短横线。");
    return value;
}
export function read(path) {
    return JSON.parse(readFileSync(path, "utf8"));
}
export function optional(path) {
    return existsSync(path) ? read(path) : undefined;
}
export function syncDir(path) {
    const fd = openSync(path, "r");
    try {
        fsyncSync(fd);
    }
    finally {
        closeSync(fd);
    }
}
export function atomic(path, data) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${randomUUID()}.tmp`;
    const fd = openSync(temporary, "wx", 0o600);
    try {
        writeFileSync(fd, data);
        fsyncSync(fd);
    }
    finally {
        closeSync(fd);
    }
    renameSync(temporary, path);
    syncDir(dirname(path));
}
export function json(path, value) {
    atomic(path, `${JSON.stringify(value, null, 2)}\n`);
}
export function immutable(path, value) {
    if (existsSync(path)) {
        check(hash(read(path)) === hash(value), "IMMUTABLE_CONFLICT", "不可变记录已存在且内容不同。", { path });
        return;
    }
    json(path, value);
}
export async function withLock(directory, fn) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, ".writer-lock");
    for (let attempt = 0;; attempt++) {
        try {
            mkdirSync(path, { mode: 0o700 });
            break;
        }
        catch (error) {
            if (error.code !== "EEXIST")
                throw error;
            const owner = optional(join(path, "owner.json"));
            let alive = false;
            if (owner) {
                try {
                    process.kill(owner.pid, 0);
                    alive = true;
                }
                catch (e) {
                    alive = e.code === "EPERM";
                }
            }
            if (!alive && (owner || Date.now() - statSync(path).mtimeMs > 5000)) {
                rmSync(path, { recursive: true, force: true });
                continue;
            }
            check(attempt < 150, "WORKSPACE_BUSY", "另一项本地操作正在写入，请稍后重试。");
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
    }
    json(join(path, "owner.json"), { pid: process.pid, startedAt: now() });
    try {
        return await fn();
    }
    finally {
        rmSync(path, { recursive: true, force: true });
    }
}
export function jsonFiles(directory) {
    if (!existsSync(directory))
        return [];
    return readdirSync(directory)
        .filter((x) => x.endsWith(".json"))
        .map((x) => read(join(directory, x)));
}
