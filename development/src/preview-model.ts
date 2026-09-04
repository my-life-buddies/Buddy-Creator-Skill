import { bookConfirmed, confirmed } from "./domain.js";
import { CARDS, CHAPTERS, STAGES } from "./rules.js";
import type { Artifact, Delivery, ProjectState, Stage } from "./types.js";

export type PreviewStatus = "confirmed" | "accepted" | "rejected" | "pending" | "revised";
export type PreviewArtifact = Artifact & { status: PreviewStatus };
export type PreviewTopic = {
  id: string;
  title: string;
  summary: string;
  status: string;
  artifactId?: string;
  current: boolean;
};
export type PreviewGroup = { id: string; title: string; topics: PreviewTopic[] };
export const previewLabels: Record<PreviewStatus, string> = {
  confirmed: "已确认", accepted: "已采纳", rejected: "未采纳",
  pending: "待确认", revised: "待重新确认",
};
const transitionTitles: Record<string, string> = {
  "acquisition-paid": "体验后订阅", "acquisition-maintenance": "暂不订阅",
  "paid-paid": "续费", "paid-maintenance": "停止续费", "maintenance-paid": "恢复订阅",
};
export function artifactStatus(state: ProjectState, id: string): PreviewStatus {
  if (confirmed(state, id)) return "confirmed";
  if (confirmed(state, id, "accepted")) return "accepted";
  if (confirmed(state, id, "rejected")) return "rejected";
  return state.confirmations.some((c) => c.objectId === id) ? "revised" : "pending";
}
function objectForTarget(state: ProjectState, id: string) {
  const candidate = id.startsWith("H") ? `hypothesis.H${Number(id.slice(1))}`
    : /^[ME]/.test(id) ? `scenario.${id}`
    : id.startsWith("T.") ? `transition.${id.split(".")[1]}`
    : id.startsWith("D") ? `definition.${Number(id.slice(1))}` : undefined;
  return candidate && state.artifacts[candidate] ? candidate : undefined;
}
function phaseFor(id: string | undefined, stage: Stage) {
  if (id?.startsWith("hypothesis.") || id?.startsWith("H")) return "候选校准";
  if (id?.startsWith("M") || id?.startsWith("scenario.M")) return "基础情境";
  if (id?.startsWith("E") || id?.startsWith("scenario.E")) return "拓展情境";
  if (id?.startsWith("T.") || id?.startsWith("transition.")) return "用户路径";
  if (id === "service.blueprint") return "服务模式确认";
  if (id === "R00") return "本次优化";
  if (id === "S00") return "规划方式";
  if (id && /^(definition|knowledge|methods|service)\.\d+$/.test(id)) return "手册确认";
  return { definition: "创作定义", knowledge: "知识整理", methods: "候选校准", service: "服务规划" }[stage];
}

/** Read-only projection: business confirmation remains governed by domain.ts. */
export function projectPreview(state: ProjectState, delivery?: Delivery) {
  const artifacts: PreviewArtifact[] = Object.values(state.artifacts).map((a) => ({
    ...a, status: artifactStatus(state, a.id),
  }));
  // A previous delivery can remain visible while its response is being processed.
  // Only use pointers whose stage, cycle and object versions still match.
  const question = delivery?.question;
  const targetId = question && CARDS[question.targetId]?.stage === state.stage &&
    state.targets[question.targetId]?.cycleId === question.cycleId ? question.targetId : undefined;
  const requested = delivery?.confirmationTarget?.stage === state.stage
    ? delivery.confirmationTarget.objects.filter((r) => state.artifacts[r.id]?.hash === r.hash).map((r) => r.id)
    : [];
  const pending = (a: PreviewArtifact) => ["pending", "revised"].includes(a.status);
  const hypotheses = artifacts.filter((a) => a.kind === "hypothesis").sort((a, b) => a.id.localeCompare(b.id));
  const targetObject = targetId && objectForTarget(state, targetId);
  const allComplete = STAGES.every((s) => bookConfirmed(state, s));
  let focusIds = targetObject ? [targetObject] : requested.filter((id) => pending(artifacts.find((a) => a.id === id)!));
  if (!focusIds.length && !targetId) {
    const candidate = artifacts.find((a) => a.stage === state.stage && pending(a));
    if (candidate) focusIds = [candidate.id];
  }
  const focus = artifacts.find((a) => a.id === focusIds[0]);
  const firstTarget = Object.entries(CARDS).find(([id, c]) => c.stage === state.stage &&
    !/^(H|T\.|R00)/.test(id) && state.targets[id]?.status === "unstarted")?.[0];
  const currentTarget = targetId ?? (!focus && !allComplete && !(state.stage === "methods" && !hypotheses.length) ? firstTarget : undefined);
  const topicTitle = currentTarget?.startsWith("T.")
    ? `${transitionTitles[currentTarget.split(".")[1]!] ?? "用户路径"} / ${["时点", "权益", "表达"][Number(currentTarget.split(".")[2]) - 1]}`
    : currentTarget ? CARDS[currentTarget]?.title : undefined;
  const current = {
    stage: state.stage,
    phase: allComplete && !targetId && !focus ? "创作完成" : phaseFor(currentTarget ?? focus?.id, state.stage),
    title: focusIds.length > 1 ? `${{ definition: "定义", knowledge: "知识", methods: "方法", service: "服务" }[state.stage]}手册`
      : focus?.title ?? topicTitle ?? (allComplete ? "四本手册已完成" : state.stage === "methods" ? "整理方法候选" : "整理当前内容"),
    targetId: currentTarget,
    artifactIds: focusIds,
    summary: currentTarget ? state.targets[currentTarget]?.summary ?? "" : "",
    status: state.paused ? "已暂停" : focus ? previewLabels[focus.status] : allComplete ? "已完成" : "讨论中",
    position: focus?.kind === "hypothesis" ? { index: hypotheses.findIndex((a) => a.id === focus.id) + 1, total: hypotheses.length } : undefined,
  };
  const topic = (id: string): PreviewTopic => {
    const aId = objectForTarget(state, id), a = artifacts.find((a) => a.id === aId), t = state.targets[id];
    return {
      id, title: a?.kind === "hypothesis" ? a.title : CARDS[id]!.title,
      summary: t?.summary ?? "", artifactId: aId,
      current: id === currentTarget || Boolean(aId && focusIds.includes(aId)),
      status: a ? previewLabels[a.status] : t?.status === "sufficient" ? "已记录"
        : t?.status === "skipped" ? "已跳过" : t?.summary ? "待补充" : "未开始",
    };
  };
  const stages = STAGES.map((stage, index) => {
    const ids = Object.keys(CARDS).filter((id) => CARDS[id]!.stage === stage);
    const groups: PreviewGroup[] = [];
    const group = (id: string, title: string, targets: string[]) => groups.push({ id, title, topics: targets.map(topic) });
    if (stage === "methods") {
      group("candidates", "方法候选", hypotheses.map((a) => `H${a.id.split("H")[1]!.padStart(2, "0")}`));
      group("base", "基础情境", ids.filter((id) => id.startsWith("M")));
      group("extended", "拓展情境", ids.filter((id) => id.startsWith("E")));
    } else if (stage === "service") {
      group("planning", "服务规划", ids.filter((id) => id.startsWith("S")));
      groups.push({ id: "paths", title: "用户路径", topics: Object.entries(transitionTitles).map(([id, title]) => {
        const a = artifacts.find((a) => a.id === `transition.${id}`);
        return { id: `path.${id}`, title, summary: "", artifactId: a?.id,
          current: currentTarget?.startsWith(`T.${id}.`) || focusIds.includes(`transition.${id}`),
          status: a ? previewLabels[a.status] : id === "maintenance-paid" ? "系统固定" : "未开始" };
      }) });
    } else if (stage === "knowledge") group("interview", "知识整理", ids);
    groups.push({ id: "booklet", title: "Booklet", topics: CHAPTERS[stage].map((title, i) => {
      const id = `${stage}.${i + 1}`, a = artifacts.find((a) => a.id === id);
      const target = stage === "definition" ? state.targets[`D0${i + 1}`] : undefined;
      return { id, title, summary: target?.summary ?? "", artifactId: a?.id,
        current: focusIds.includes(id) || Boolean(target && target.id === currentTarget),
        status: a ? previewLabels[a.status] : target?.status === "sufficient" ? "已记录" : target?.summary ? "待补充" : "待形成" };
    }) });
    const status = bookConfirmed(state, stage) ? "已确认"
      : artifacts.some((a) => a.stage === stage && a.status === "revised") ? "待重新确认"
      : artifacts.some((a) => a.stage === stage && a.kind === "chapter") ? "待确认"
      : stage === state.stage || ids.some((id) => state.targets[id]?.status !== "unstarted") ? "进行中" : "未开始";
    return { id: stage, number: index + 1, title: ["定义", "知识", "方法", "服务"][index]!,
      current: stage === state.stage, status, groups,
      confirmedChapters: artifacts.filter((a) => a.stage === stage && a.kind === "chapter" && a.status === "confirmed").length,
      totalChapters: CHAPTERS[stage].length };
  });
  return { current, stages, artifacts };
}
