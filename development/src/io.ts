import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

export class BuddyError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "BuddyError";
  }
}
export function check(
  value: unknown,
  code: string,
  message: string,
  details?: unknown,
): asserts value {
  if (!value) throw new BuddyError(code, message, details);
}
export function canonical(value: unknown): string {
  if (value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export const hash = (value: unknown) =>
  createHash("sha256")
    .update(
      typeof value === "string" || Buffer.isBuffer(value)
        ? value
        : canonical(value),
    )
    .digest("hex");
export const id = (prefix: string) => `${prefix}_${randomUUID()}`;
export const now = () => new Date().toISOString();
export function safeId(value: string) {
  check(
    /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,150}$/.test(value) && value !== "..",
    "INVALID_ID",
    "标识只能包含字母、数字、下划线、点和短横线。",
  );
  return value;
}
export function read<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}
export function optional<T>(path: string): T | undefined {
  return existsSync(path) ? read<T>(path) : undefined;
}
export function syncDir(path: string) {
  const fd = openSync(path, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
export function atomic(path: string, data: string | Buffer) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  const fd = openSync(temporary, "wx", 0o600);
  try {
    writeFileSync(fd, data);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temporary, path);
  syncDir(dirname(path));
}
export function json(path: string, value: unknown) {
  atomic(path, `${JSON.stringify(value, null, 2)}\n`);
}
export function immutable(path: string, value: unknown) {
  if (existsSync(path)) {
    check(
      hash(read(path)) === hash(value),
      "IMMUTABLE_CONFLICT",
      "不可变记录已存在且内容不同。",
      { path },
    );
    return;
  }
  json(path, value);
}
export async function withLock<T>(
  directory: string,
  fn: () => T | Promise<T>,
): Promise<T> {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, ".writer-lock");
  for (let attempt = 0; ; attempt++) {
    try {
      mkdirSync(path, { mode: 0o700 });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const owner = optional<{ pid: number }>(join(path, "owner.json"));
      let alive = false;
      if (owner) {
        try {
          process.kill(owner.pid, 0);
          alive = true;
        } catch (e) {
          alive = (e as NodeJS.ErrnoException).code === "EPERM";
        }
      }
      if (!alive && (owner || Date.now() - statSync(path).mtimeMs > 5000)) {
        rmSync(path, { recursive: true, force: true });
        continue;
      }
      check(
        attempt < 150,
        "WORKSPACE_BUSY",
        "另一项本地操作正在写入，请稍后重试。",
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  json(join(path, "owner.json"), { pid: process.pid, startedAt: now() });
  try {
    return await fn();
  } finally {
    rmSync(path, { recursive: true, force: true });
  }
}
export function jsonFiles<T>(directory: string): T[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((x) => x.endsWith(".json"))
    .map((x) => read<T>(join(directory, x)));
}
