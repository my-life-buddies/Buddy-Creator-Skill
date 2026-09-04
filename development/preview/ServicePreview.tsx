import { useEffect, useRef, useState } from "react";
import { ArrowsOut, X } from "@phosphor-icons/react";
import { BlueprintCanvas, createDefaultServiceBlueprint, type ServiceBlueprint, type ServiceStageId, type ServiceTransitionId } from "./ServiceBlueprint";
import type { VisibleArtifact } from "./main";
import { subscriptionPrice } from "../src/subscription";
import { SERVICE_STAGE_MEANINGS } from "../src/service-policy";

const fields: Record<string, string> = {
  goal: "服务目标", result: "交付结果", service: "服务内容", limit: "服务边界", widget: "呈现方式",
  proactive: "主动服务", human: "创作者复核", exit: "结束与衔接", trigger: "何时发生",
  paywall: "付费提示", rightsChange: "服务权益", dataInheritance: "历史与进度", message: "对用户的表达",
};
export function ServicePreview({ artifact, paths, onBrowse }: { artifact?: VisibleArtifact; paths: VisibleArtifact[]; onBrowse: () => void }) {
  const [stage, setStage] = useState<ServiceStageId | null>(null), [transition, setTransition] = useState<ServiceTransitionId | null>(null);
  const [expanded, setExpanded] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!expanded || !dialog.current) return;
    const modal = dialog.current, previous = document.body.style.overflow;
    document.body.style.overflow = "hidden"; modal.showModal();
    return () => { modal.close(); document.body.style.overflow = previous; };
  }, [expanded]);
  const base = createDefaultServiceBlueprint(), supplied = (artifact?.data ?? {}) as Partial<ServiceBlueprint>;
  const blueprint: ServiceBlueprint = {
    ...base, ...supplied,
    stages: { ...base.stages }, transitions: { ...base.transitions },
    serviceLoop: { ...base.serviceLoop, ...supplied.serviceLoop },
    acquisitionContract: { ...base.acquisitionContract, ...supplied.acquisitionContract },
    deliveries: supplied.deliveries ?? "",
    widget: supplied.widget ?? "",
  };
  for (const id of Object.keys(base.stages) as ServiceStageId[]) blueprint.stages[id] = {
    ...base.stages[id], ...supplied.stages?.[id], widget: supplied.stages?.[id]?.widget ?? "", status: artifact?.status === "confirmed" ? "confirmed" : artifact ? "suggested" : "undefined",
  };
  for (const id of Object.keys(base.transitions) as ServiceTransitionId[]) {
    const path = paths.find((a) => a.id === `transition.${id}`);
    blueprint.transitions[id] = { ...base.transitions[id], ...supplied.transitions?.[id], ...path?.data };
  }
  const detail = stage ? blueprint.stages[stage] : transition ? blueprint.transitions[transition] : undefined;
  const oldRules = artifact && (artifact.data?.platformRules as { free?: { scope?: string }; paid?: { aiConversationLimit?: string } } | undefined);
  const needsPolicyUpdate = Boolean(artifact && (oldRules?.free?.scope !== "creator_defined" || oldRules?.paid?.aiConversationLimit !== "unlimited"));
  const detailArtifact = paths.find((a) => a.id === `transition.${transition}`) ?? artifact;
  const status = artifact?.status === "confirmed" ? "已确认" : artifact?.status === "revised" ? "待重新确认" : artifact ? "待确认" : "固定结构 · 内容待讨论";
  const canvas = (compact: boolean) => <BlueprintCanvas compact={compact} blueprint={blueprint} proposal={null} selectedStage={stage} selectedTransition={transition}
    onStage={(id) => { onBrowse(); setStage(id); setTransition(null); }} onTransition={(id) => { onBrowse(); setTransition(id); setStage(null); }} />;
  const details = () => detail ? <section className="service-detail" aria-label={`${detail.title}详情`} data-buddy-object-id={detailArtifact?.id} data-buddy-version={detailArtifact?.hash}>
    <div className="section-title"><h3>{detail.title}</h3><span>{transition === "maintenance-paid" ? "系统固定" : detailArtifact?.status === "confirmed" ? "已确认" : detailArtifact?.status === "revised" ? "待重新确认" : detailArtifact ? "待确认" : status}</span></div>
    {stage && <p className="service-stage-meaning">{SERVICE_STAGE_MEANINGS[stage].detail}</p>}
    <dl>{stage === "paid" && <><div><dt>与搭子对话</dt><dd>不限次数</dd></div><div><dt>真人对话</dt><dd>{blueprint.humanConversationLimit || "是否提供、次数和时长由创作者约定"}</dd></div></>}
    {stage === "maintenance" && <div><dt>基础对话</dt><dd>{blueprint.maintenanceContract?.allowedQuestions || "日常交流、普通答疑和已有结果解释"}</dd></div>}
    {Object.entries(fields).flatMap(([key, label]) => {
      const value = (detail as unknown as Record<string, unknown>)[key];
      return typeof value === "string" && value ? [<div key={key}><dt>{label}</dt><dd>{value}</dd></div>] : [];
    })}
    {stage === "acquisition" && Object.entries({ requiredInput: "用户输入", includedSteps: "包含步骤", completionCriteria: "体验结束条件", excludedSteps: "不包含", conversionBridge: "继续服务的价值" }).flatMap(([key, label]) => {
      const raw = blueprint.acquisitionContract[key as keyof typeof blueprint.acquisitionContract], value = Array.isArray(raw) ? raw.join("；") : raw;
      return value ? [<div key={key}><dt>{label}</dt><dd>{value}</dd></div>] : [];
    })}
    {stage === "paid" && Object.entries({ trigger: "开始条件", requiredInput: "所需输入", decision: "关键判断", action: "行动", result: "结果", feedback: "反馈", nextCycleUpdate: "下次更新" }).flatMap(([key, label]) => {
      const value = blueprint.serviceLoop[key as keyof typeof blueprint.serviceLoop];
      return value ? [<div key={key}><dt>{label}</dt><dd>{value}</dd></div>] : [];
    })}</dl>
    {!detailArtifact && <p className="empty">以上为系统固定规则，具体服务内容将在访谈中补充。</p>}
  </section> : <p className="map-hint">选择阶段或路径，查看具体内容。</p>;
  return <section className="service-section" id="service.blueprint" data-buddy-object-id="service.blueprint" data-buddy-version={artifact?.hash}>
    <div className="section-title"><h2>服务模式</h2><button className="text-button" onClick={() => { onBrowse(); setExpanded(true); }}><ArrowsOut size={15} />展开大图</button></div>
    <div className="map-frame"><div className="map-caption"><span>三阶段 · 五条路径</span><span>{status}</span></div>
      <dl className="service-stage-guide" aria-label="三个阶段的含义">
        {Object.entries(SERVICE_STAGE_MEANINGS).map(([id, meaning]) => <div key={id}><dt>{meaning.title}</dt><dd><strong>{meaning.plain}</strong><p>{meaning.detail}</p></dd></div>)}
      </dl>
      {needsPolicyUpdate && <p className="service-policy-update">这份方案沿用了旧规则，需在主对话中修订。上方阶段说明已采用新规则。</p>}
      <dl className="subscription-summary" aria-label="订阅约定">
        <div><dt>订阅与价格</dt><dd>{subscriptionPrice(blueprint.price, blueprint.billingCycle)}</dd></div>
        <div><dt>交付频率</dt><dd>{blueprint.cadence || "待讨论"}</dd></div>
      </dl>
      {canvas(true)}{details()}</div>
    {expanded && <dialog ref={dialog} className="blueprint-dialog" aria-label="服务模式大图" onClose={() => setExpanded(false)}>
      <div className="dialog-header"><h2>服务模式</h2><button className="text-button" aria-label="关闭大图" onClick={() => dialog.current?.close()} autoFocus><X size={20} />关闭</button></div>
      <div className="dialog-scroll"><dl className="service-stage-guide" aria-label="三个阶段的含义">{Object.entries(SERVICE_STAGE_MEANINGS).map(([id, meaning]) => <div key={id}><dt>{meaning.title}</dt><dd><strong>{meaning.plain}</strong><p>{meaning.detail}</p></dd></div>)}</dl><div className="large-map">{canvas(false)}</div>{details()}</div>
    </dialog>}
  </section>;
}
