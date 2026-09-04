import { existsSync, statSync } from "node:fs";
import { jsonFiles, optional, safeId } from "./io.js";
import type { Store } from "./store.js";
import type { Draft } from "./preview.js";
import type { ProjectState, Session, SourceManifest, Turn, WorkItem } from "./types.js";

export type PreviewActivity = {
  mode: "working" | "waiting" | "ready" | "paused" | "attention";
  label: string;
  detail?: string;
};

function modified(path: string) {
  return existsSync(path) ? statSync(path).mtimeMs : 0;
}

function working(label: string, lastSignal: number, time: number): PreviewActivity {
  const elapsed = Math.max(0, time - lastSignal);
  // A pending host request does not prove that the host is still running.
  if (!lastSignal || elapsed >= 120_000)
    return { mode: "waiting", label: "本轮还未完成", detail: "回主对话查看进展" };
  return {
    mode: "working", label,
    ...(elapsed >= 30_000 ? { detail: "可先阅读已有内容" } : {}),
  };
}

export function previewActivity(
  store: Store,
  state: ProjectState,
  session: Session | undefined,
  accepted: Set<string>,
  drafts: Draft[],
  sources: SourceManifest[],
  time = Date.now(),
): PreviewActivity | null {
  const dialogue = store.dialogue();
  const latest = dialogue.latestInputId;
  const delivery = dialogue.activeDeliveryId ? store.delivery(dialogue.activeDeliveryId) : undefined;
  const answered = !latest || state.answeredInputs.includes(latest) || delivery?.inputId === latest;
  if (session?.paused || (state.paused && answered))
    return { mode: "paused", label: "已暂停" };

  const runningSources = sources.filter((s) => s.status === "running" || s.status === "queued");
  if (!answered && session) {
    const input = store.input(latest!);
    const turn = session.activeRequestId
      ? optional<Turn>(store.path("runtime-work", "turns", `${safeId(session.activeRequestId)}.json`)) : undefined;
    const currentTurn = turn?.inputId === input.id && turn.epoch === session.epoch && turn.sessionId === session.id ? turn : undefined;
    // A cancellation advances the epoch; only a newly prepared turn may restart it.
    if (!currentTurn && jsonFiles<Turn>(store.path("runtime-work", "turns"))
      .some((past) => past.inputId === input.id && existsSync(store.path("runtime-work", "cancelled", `${safeId(past.requestId)}.json`))))
      return null;
    const items = currentTurn ? jsonFiles<WorkItem>(store.path("runtime-work", "items"))
      .filter((item) => item.requestId === currentTurn.requestId && item.operationEpoch === session.epoch && item.baseRevision === state.revision) : [];
    const pending = items.find((item) => !accepted.has(item.stepId));
    const signals = [
      modified(store.path("inputs", "records", `${safeId(input.id)}.json`)),
      ...items.map((item) => modified(store.path("runtime-work", "items", `${safeId(item.stepId)}.json`))),
      ...drafts.map((draft) => modified(store.path("drafts", `${safeId(draft.id)}.json`))),
    ];
    if (!currentTurn && (input.sessionId !== session.id || (!runningSources.length && time - Math.max(...signals) >= 120_000)))
      return { mode: "waiting", label: "等待对话继续", detail: "已保存的内容仍可阅读" };
    if (currentTurn || !runningSources.length) {
      if (!currentTurn && sources.some((s) => state.sourcePlan.sourceIds.includes(s.id) && s.status === "failed"))
        return { mode: "attention", label: "资料需要处理", detail: "回主对话查看原因" };
      const names: Record<WorkItem["kind"], string> = {
        interview_turn: "正在梳理你的想法",
        knowledge_synthesis: "正在整理知识资料",
        artifact_draft: "正在整理手册",
        artifact_revision: "正在修改相关内容",
        conflict_review: "正在核对修改内容",
        delivery_compose: "正在整理回复",
        source_process: "正在读取资料",
      };
      const label = drafts.length ? "正在整理手册" : pending ? names[pending.kind] : currentTurn ? "正在整理回复" : "正在梳理你的想法";
      return working(label, Math.max(...signals), time);
    }
  }
  if (runningSources.length) {
    const signal = Math.max(...runningSources.map((source) => modified(store.path("sources", safeId(source.id), "versions", `${safeId(source.version)}.json`))));
    return working(runningSources.some((s) => s.status === "running") ? "正在读取资料" : "正在准备资料", signal, time);
  }
  if (latest && delivery?.inputId === latest && !store.shown(delivery.id))
    return { mode: "ready", label: "回复已整理", detail: "等待主对话展示" };
  return null;
}
