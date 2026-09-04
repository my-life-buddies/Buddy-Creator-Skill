import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { collectDeliverables, handoffStatus } from "./handoff.js";
import { atomic, hash, json, jsonFiles, now, optional, safeId, syncDir, withLock } from "./io.js";
import type { Store } from "./store.js";
import type { Delivery, ProjectState } from "./types.js";

type CompletionRecord = {
  version: 1; buddyId: string; revision: string;
  status: "ready" | "failed"; createdAt: string; updatedAt: string;
  manifestHash?: string; fileCount?: number; error?: string;
};
type Manifest = ReturnType<typeof collectDeliverables>["manifest"];

function ready(store: Store, state: ProjectState) {
  if (state.paused || store.session()?.paused || !handoffStatus(store, state).ready) return false;
  const completed = new Set(state.answeredInputs);
  let revision: string | undefined = state.revision;
  while (revision) {
    const record = store.revision(revision);
    if (record.delivery?.inputId) completed.add(record.delivery.inputId);
    revision = record.parent;
  }
  for (const event of jsonFiles<{ delivery: Delivery }>(store.path("deliveries", "events")))
    if (event.delivery.inputId) completed.add(event.delivery.inputId);
  return !jsonFiles<{ inputId: string }>(store.path("inputs", "tickets")).some((ticket) =>
    !completed.has(ticket.inputId) && existsSync(store.path("inputs", "records", `${safeId(ticket.inputId)}.json`)));
}
function paths(store: Store, revision: string) {
  return { directory: store.path("deliverables", safeId(revision)),
    record: store.path("deliverables", "status", `${safeId(revision)}.json`) };
}
function intact(directory: string, record: CompletionRecord, full: boolean) {
  try {
    const bytes = readFileSync(join(directory, "MANIFEST.json"));
    if (hash(bytes) !== record.manifestHash) return false;
    const manifest = JSON.parse(bytes.toString()) as Manifest;
    if (manifest.revision !== record.revision || manifest.buddyId !== record.buddyId || !manifest.complete) return false;
    return manifest.files.every((file) => existsSync(join(directory, file.path)) && (!full || (
      readFileSync(join(directory, file.path)).length === file.bytes &&
      hash(readFileSync(join(directory, file.path))) === file.sha256)));
  } catch { return false; }
}

/** The CLI holds the project lock; this lock also protects direct concurrent finalizers. */
export async function ensureCompletion(store: Store): Promise<CompletionRecord | undefined> {
  return withLock(store.path("deliverables", ".finalize-lock"), () => {
    const state = store.load();
    if (!ready(store, state)) return undefined;
    const { directory, record: recordPath } = paths(store, state.revision);
    const previous = optional<CompletionRecord>(recordPath);
    if (previous?.status === "ready" && intact(directory, previous, true)) {
      json(store.path("deliverables", "current.json"), { revision: state.revision, directory });
      return previous;
    }
    const base = { version: 1 as const, buddyId: state.buddyId, revision: state.revision,
      createdAt: previous?.createdAt ?? now(), updatedAt: now() };
    const staging = store.path("deliverables", `.staging-${randomUUID()}`);
    try {
      const { files } = collectDeliverables(store, state);
      mkdirSync(staging, { recursive: true, mode: 0o700 });
      for (const [path, bytes] of Object.entries(files)) atomic(join(staging, path), Buffer.from(bytes));
      const record: CompletionRecord = { ...base, status: "ready", fileCount: Object.keys(files).length,
        manifestHash: hash(Buffer.from(files["MANIFEST.json"]!)) };
      if (!intact(staging, record, true)) throw new Error("本地成果未完整写入，请重试生成。");
      // Preserve changed derived files for inspection; original interview records are never rewritten.
      if (existsSync(directory)) renameSync(directory, `${directory}.previous-${randomUUID()}`);
      renameSync(staging, directory);
      syncDir(store.path("deliverables"));
      json(recordPath, record);
      json(store.path("deliverables", "current.json"), { revision: state.revision, directory });
      return record;
    } catch (error) {
      rmSync(staging, { recursive: true, force: true });
      const record: CompletionRecord = { ...base, status: "failed", error: error instanceof Error ? error.message : String(error) };
      json(recordPath, record);
      return record;
    }
  });
}

/** The preview receives a projection without local filesystem paths. */
export function completionSnapshot(store: Store) {
  const state = store.load();
  if (!ready(store, state)) return undefined;
  const { directory, record: recordPath } = paths(store, state.revision);
  const record = optional<CompletionRecord>(recordPath);
  if (!record || record.revision !== state.revision || record.buddyId !== state.buddyId) return undefined;
  const valid = record.status === "ready" && intact(directory, record, false);
  return { revision: state.revision, status: valid ? "ready" as const : "failed" as const,
    message: valid ? "四册已确认，创作手册和服务模式图已保存在本机。" : "四册确认已保留，本地成果生成需要重试。",
    fileCount: valid ? record.fileCount : undefined, updatedAt: record.updatedAt };
}
export async function withCompletion(store: Store, directive: Record<string, unknown>) {
  try {
    const record = await ensureCompletion(store);
    if (!record) return directive;
    const completion = completionSnapshot(store)!;
    const { directory } = paths(store, record.revision);
    return { ...directive, completion: { ...completion,
      ...(record.status === "ready" ? { directory, manualPath: join(directory, "BUDDY_MANUAL.md") } : { error: record.error }),
    }, completionInstruction: record.status === "ready"
      ? "说明 completion.message，提供 manualPath 查看入口。已有 delivery 按原展示协议处理，不修改历史回复；不要求下载 ZIP，不发起开发交接。"
      : "确认记录已保存。处理 completion.error 后调用 finalize 重试，不要求创作者重新确认。" };
  } catch (error) {
    return { ...directive, completionIssue: { message: error instanceof Error ? error.message : String(error),
      recovery: "本轮提交已保存。处理错误后调用 finalize 重试，不重新采访。" } };
  }
}
