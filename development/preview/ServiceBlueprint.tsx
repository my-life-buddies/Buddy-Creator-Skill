import React, {
  type CSSProperties,
  type Ref,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { ArrowRight } from "@phosphor-icons/react";
import { subscriptionPrice, type BillingCycle } from "../src/subscription";
import { SERVICE_STAGE_MEANINGS } from "../src/service-policy";
export type ServiceValueType = "" | "continuous" | "periodic" | "quota";
export type ServicePlanningMode = "smart" | "guided";
export type ServiceStageId = "acquisition" | "paid" | "maintenance";
export type ServiceTransitionId =
  | "acquisition-paid"
  | "acquisition-maintenance"
  | "paid-paid"
  | "paid-maintenance"
  | "maintenance-paid";
export type ServiceConfigStatus =
  "undefined" | "suggested" | "confirmed" | "conflict";

export type ServiceLoop = {
  trigger: string;
  requiredInput: string;
  decision: string;
  action: string;
  result: string;
  feedback: string;
  nextCycleUpdate: string;
};

export type AcquisitionContract = {
  trigger: string;
  requiredInput: string;
  includedSteps: string[];
  completionCriteria: string;
  excludedSteps: string[];
  conversionBridge: string;
};

export type ServiceStageConfig = {
  id: ServiceStageId;
  title: string;
  goal: string;
  result: string;
  service: string;
  limit: string;
  widget: string;
  modelPolicy: string;
  proactive: string;
  human: string;
  cost: string;
  exit: string;
  status: ServiceConfigStatus;
};

export type ServiceTransitionConfig = {
  id: ServiceTransitionId;
  title: string;
  from: ServiceStageId;
  to: ServiceStageId;
  trigger: string;
  paywall: string;
  rightsChange: string;
  dataInheritance: string;
  message: string;
  status: ServiceConfigStatus;
};

export type ServiceBlueprint = {
  version: 1;
  valueType: ServiceValueType;
  valueStatement: string;
  recurrenceDrivers: string[];
  serviceLoop: ServiceLoop;
  acquisitionContract: AcquisitionContract;
  maintenanceContract?: {
    basicConversation?: boolean;
    allowedQuestions: string;
  };
  renewalEvidence: string[];
  billingCycle?: BillingCycle;
  price: string | number;
  cadence: string;
  deliveries: string;
  conversationLimit: string;
  humanConversationLimit?: string;
  toolLimit: string;
  widget: string;
  experienceMode?: "conversation" | "custom-component";
  customComponentDescription?: string;
  transitionInterviewQuestions?: Partial<Record<ServiceTransitionId, string[]>>;
  transitionQuestionFormatVersion?: number;
  humanReview: boolean;
  reviewCapacity: string;
  multiUser: false;
  stages: Record<ServiceStageId, ServiceStageConfig>;
  transitions: Record<ServiceTransitionId, ServiceTransitionConfig>;
};

export type ServiceProposal = {
  phase: "acquisition" | "paid";
  blueprint: ServiceBlueprint;
  rationale: string;
  gate: {
    status: "PASS" | "BLOCK";
    failedRules: string[];
    repairQuestion: string;
  };
};

export type ServiceBookletDraft = {
  version: 2;
  sections: Array<{ key: string; title: string; markdown: string }>;
};

export type ServiceModeMessage = {
  role: "creator" | "assistant";
  text: string;
};

export type ServiceBlueprintFocus =
  | { kind: "stage"; id: ServiceStageId; title: string }
  | { kind: "transition"; id: ServiceTransitionId; title: string };

const MAC_SPEECH_KEY = "agenthub-mac-speech-config";

const stageTitles: Record<ServiceStageId, string> = {
  acquisition: "获客期",
  paid: "付费期",
  maintenance: "维持期",
};

const transitionOrder: ServiceTransitionId[] = [
  "acquisition-paid",
  "acquisition-maintenance",
  "paid-paid",
  "paid-maintenance",
  "maintenance-paid",
];

const interviewTransitionOrder: ServiceTransitionId[] = [
  "acquisition-paid",
  "acquisition-maintenance",
  "paid-paid",
  "paid-maintenance",
];

const valueOptions: Array<{
  id: Exclude<ServiceValueType, "">;
  title: string;
  detail: string;
  example: string;
}> = [
  {
    id: "continuous",
    title: "随时陪伴",
    detail: "订阅期内，用户随时回来继续聊，搭子记得前面的情况并接着帮。",
    example: "适合长期顾问、教练和陪伴型搭子",
  },
  {
    id: "periodic",
    title: "定期交付",
    detail: "用户每周或每月拿到一份新的计划、复盘、方案或报告。",
    example: "适合结果按固定节奏更新的搭子",
  },
  {
    id: "quota",
    title: "固定次数",
    detail: "订阅期内可约定交付、工具或真人服务次数；与搭子的对话不限次数。",
    example: "适合单次成本较高的搭子",
  },
];

const widgetOptions = [
  {
    id: "conversation" as const,
    title: "纯对话",
    detail: "所有服务都在对话中完成，不增加额外页面组件。",
  },
  {
    id: "custom-component" as const,
    title: "对话 + 自定义组件",
    detail: "保留对话，同时用一个专门组件持续呈现重要结果或进度。",
  },
];

export function createDefaultServiceBlueprint(): ServiceBlueprint {
  return {
    version: 1,
    valueType: "",
    valueStatement: "",
    recurrenceDrivers: [],
    serviceLoop: {
      trigger: "",
      requiredInput: "",
      decision: "",
      action: "",
      result: "",
      feedback: "",
      nextCycleUpdate: "",
    },
    acquisitionContract: {
      trigger: "",
      requiredInput: "",
      includedSteps: [],
      completionCriteria: "",
      excludedSteps: [],
      conversionBridge: "",
    },
    maintenanceContract: {
      basicConversation: true,
      allowedQuestions: "日常交流、基础问题答疑与已有结果解释",
    },
    renewalEvidence: [],
    billingCycle: undefined,
    price: "",
    cadence: "",
    deliveries: "",
    conversationLimit: "unlimited",
    humanConversationLimit: "",
    toolLimit: "",
    widget: "",
    experienceMode: undefined,
    customComponentDescription: "",
    transitionInterviewQuestions: {},
    transitionQuestionFormatVersion: 0,
    humanReview: false,
    reviewCapacity: "",
    multiUser: false,
    stages: {
      acquisition: {
        id: "acquisition",
        title: "获客期",
        goal: "",
        result: "",
        service: "",
        limit: "",
        widget: "结果卡",
        modelPolicy: "",
        proactive: "",
        human: "",
        cost: "",
        exit: "按约定完成免费体验后，由用户选择订阅或保留基础使用",
        status: "undefined",
      },
      paid: {
        id: "paid",
        title: "付费期",
        goal: "",
        result: "",
        service: "",
        limit: "",
        widget: "",
        modelPolicy: "",
        proactive: "",
        human: "",
        cost: "",
        exit: "",
        status: "undefined",
      },
      maintenance: {
        id: "maintenance",
        title: "维持期",
        goal: "",
        result: "",
        service: "保留基础对话、普通问题答疑与历史查看",
        limit: "不自动包含新的付费交付、真人服务与高成本工具",
        widget: "历史归档",
        modelPolicy: "",
        proactive: "不主动触达",
        human: "不进入人工复核",
        cost: "低",
        exit: "用户再次购买时恢复付费权益与历史",
        status: "undefined",
      },
    },
    transitions: {
      "acquisition-paid": {
        id: "acquisition-paid",
        title: "体验后订阅",
        from: "acquisition",
        to: "paid",
        trigger: "用户完成约定的免费体验并选择继续",
        paywall: "在完整结果之后展示订阅价值",
        rightsChange: "按已确认约定提供订阅服务，与搭子对话不限次数",
        dataInheritance: "继承免费期输入与结果",
        message: "保留这次结果，继续按周期陪你推进。",
        status: "undefined",
      },
      "acquisition-maintenance": {
        id: "acquisition-maintenance",
        title: "体验后保留",
        from: "acquisition",
        to: "maintenance",
        trigger: "免费体验结束但未订阅",
        paywall: "不拦截已完成的免费结果",
        rightsChange: "保留基础对话、普通答疑与历史查看",
        dataInheritance: "保留本次体验结果",
        message: "结果会继续保留，需要时可以回来继续。",
        status: "undefined",
      },
      "paid-paid": {
        id: "paid-paid",
        title: "续费",
        from: "paid",
        to: "paid",
        trigger: "付费周期到期且续费成功",
        paywall: "周期结束前提示下一周期价值",
        rightsChange: "权益连续，不重置进度",
        dataInheritance: "完整继承历史、状态与未完成事项",
        message: "新周期从上次进展继续，不需要重新开始。",
        status: "undefined",
      },
      "paid-maintenance": {
        id: "paid-maintenance",
        title: "不再续约",
        from: "paid",
        to: "maintenance",
        trigger: "周期结束且未续费",
        paywall: "不阻断已购买周期内的结果",
        rightsChange: "保留基础对话；暂停付费交付、主动服务与高成本工具",
        dataInheritance: "历史与已完成结果只读保留",
        message: "到期后仍可基础聊天和查看历史，新的付费交付暂停。",
        status: "undefined",
      },
      "maintenance-paid": {
        id: "maintenance-paid",
        title: "恢复订阅",
        from: "maintenance",
        to: "paid",
        trigger: "用户重新购买订阅",
        paywall: "在用户提出新深度需求时说明恢复权益",
        rightsChange: "恢复完整服务、主动触达与工具能力",
        dataInheritance: "从原有历史和状态继续",
        message: "继续从之前的进度开始，恢复完整服务。",
        status: "confirmed",
      },
    },
  };
}

function StageCard({
  stage,
  selected,
  core,
  label,
  showStatus = true,
  cardRef,
  onClick,
  compact = false,
}: {
  stage: ServiceStageConfig;
  selected: boolean;
  core?: Array<{ label: string; value: string }>;
  label?: string;
  showStatus?: boolean;
  cardRef?: Ref<HTMLButtonElement>;
  onClick: () => void;
  compact?: boolean;
}) {
  return (
    <button
      ref={cardRef}
      className={`service-stage-card stage-${stage.id} status-${stage.status} ${selected ? "selected" : ""} ${!compact && core?.length ? "has-core-plan" : ""}`}
      onClick={onClick}
      aria-pressed={selected}
    >
      <span>{label || SERVICE_STAGE_MEANINGS[stage.id].title}</span>
      <strong>{stage.result || { acquisition: "按约定体验搭子的帮助", paid: "持续交付完整服务", maintenance: "保留历史与基础对话" }[stage.id]}</strong>
      {!compact && stage.goal && <small>{stage.goal}</small>}
      {!compact && core?.length ? (
        <dl className="service-stage-core">
          {core.map((item) => (
            <div key={item.label}>
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {showStatus && (
        <em>
          {stage.status === "confirmed"
            ? "已确认"
            : stage.status === "suggested"
              ? "待确认建议"
              : stage.status === "conflict"
                ? "存在冲突"
                : "待讨论"}
        </em>
      )}
    </button>
  );
}

type ServiceConnectorKey = "ap" | "am" | "pp" | "pm" | "mp";
type ConnectorPoint = { x: number; y: number };
function cubicConnector(
  start: ConnectorPoint,
  first: ConnectorPoint,
  second: ConnectorPoint,
  end: ConnectorPoint,
) {
  return {
    path: `M ${start.x} ${start.y} C ${first.x} ${first.y}, ${second.x} ${second.y}, ${end.x} ${end.y}`,
    // The label sits on the curve itself, not at a control point or nearby margin.
    label: {
      x: (start.x + 3 * first.x + 3 * second.x + end.x) / 8,
      y: (start.y + 3 * first.y + 3 * second.y + end.y) / 8,
      angle: 0,
    },
  };
}
type ServiceConnectorLayout = {
  width: number;
  height: number;
  paths: Record<ServiceConnectorKey, string>;
  chips: Record<ServiceConnectorKey, { x: number; y: number; angle: number }>;
};

function connectorChipStyle(
  layout: ServiceConnectorLayout | null,
  key: ServiceConnectorKey,
): CSSProperties | undefined {
  if (!layout) return undefined;
  const chip = layout.chips[key];
  return {
    top: chip.y,
    right: "auto",
    bottom: "auto",
    left: chip.x,
    transform: `translate(-50%, -50%) rotate(${chip.angle}deg)`,
  };
}

export function BlueprintCanvas({
  blueprint,
  proposal,
  selectedStage,
  selectedTransition,
  mode = "guided",
  onStage,
  onTransition,
  onFocus,
  compact = false,
}: {
  blueprint: ServiceBlueprint;
  proposal: ServiceProposal | null;
  selectedStage: ServiceStageId | null;
  selectedTransition: ServiceTransitionId | null;
  mode?: ServicePlanningMode;
  onStage?: (id: ServiceStageId) => void;
  onTransition?: (id: ServiceTransitionId) => void;
  onFocus?: (focus: ServiceBlueprintFocus) => void;
  compact?: boolean;
}) {
  const arrowId = `service-arrow-${useId().replace(/:/g, "")}`;
  const mapRef = useRef<HTMLDivElement | null>(null);
  const acquisitionRef = useRef<HTMLButtonElement | null>(null);
  const paidRef = useRef<HTMLButtonElement | null>(null);
  const maintenanceRef = useRef<HTMLButtonElement | null>(null);
  const [connectorLayout, setConnectorLayout] =
    useState<ServiceConnectorLayout | null>(null);
  const visibleProposal = proposal?.gate.status === "PASS" ? proposal : null;
  const acquisitionSource =
    visibleProposal?.phase === "acquisition"
      ? visibleProposal.blueprint
      : blueprint;
  const paidSource =
    visibleProposal?.phase === "paid" ? visibleProposal.blueprint : blueprint;
  const acquisitionStage = acquisitionSource.stages.acquisition;
  const paidStage = paidSource.stages.paid;
  const acquisitionCore =
    acquisitionStage.status !== "undefined"
      ? [
          {
            label: "用户因为什么来",
            value: acquisitionSource.acquisitionContract.trigger,
          },
          {
            label: "搭子完成什么",
            value: acquisitionSource.acquisitionContract.includedSteps
              .slice(0, 3)
              .join("；"),
          },
          {
            label: "怎样算完成",
            value: acquisitionSource.acquisitionContract.completionCriteria,
          },
        ].filter((item) => item.value)
      : undefined;
  const paidCore =
    paidStage.status !== "undefined"
      ? [
          { label: "用户因为什么来", value: paidSource.serviceLoop.trigger },
          { label: "每次拿到什么", value: paidSource.serviceLoop.result },
          {
            label: "下次继续什么",
            value: paidSource.serviceLoop.nextCycleUpdate,
          },
        ].filter((item) => item.value)
      : undefined;
  const maintenanceCore =
    blueprint.stages.maintenance.status !== "undefined"
      ? [
          {
            label: "可以继续问",
            value: blueprint.maintenanceContract?.allowedQuestions || "",
          },
          { label: "历史信息", value: "默认保留并可查看" },
        ].filter((item) => item.value)
      : undefined;
  const smartMode = mode === "smart";

  useLayoutEffect(() => {
    const map = mapRef.current;
    const acquisition = acquisitionRef.current;
    const paid = paidRef.current;
    const maintenance = maintenanceRef.current;
    if (!map || !acquisition || !paid || !maintenance) return;

    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const mapRect = map.getBoundingClientRect();
        if (!mapRect.width || !mapRect.height) return;
        const relativeRect = (element: HTMLElement) => {
          const rect = element.getBoundingClientRect();
          return {
            left: rect.left - mapRect.left,
            right: rect.right - mapRect.left,
            top: rect.top - mapRect.top,
            bottom: rect.bottom - mapRect.top,
            width: rect.width,
            height: rect.height,
          };
        };
        const acq = relativeRect(acquisition);
        const pay = relativeRect(paid);
        const maintain = relativeRect(maintenance);
        const width = mapRect.width;
        const height = mapRect.height;
        const verticalStack = pay.top > acq.bottom;

        const apStart = verticalStack
          ? { x: acq.left + acq.width / 2, y: acq.bottom }
          : { x: acq.right, y: acq.top + acq.height / 2 };
        const apEnd = verticalStack
          ? { x: pay.left + pay.width / 2, y: pay.top }
          : { x: pay.left, y: pay.top + pay.height / 2 };
        const sideRouteLeft = Math.max(14, acq.left - 26);
        const amStart = verticalStack
          ? { x: acq.left + 16, y: acq.bottom }
          : { x: acq.left + acq.width * 0.62, y: acq.bottom };
        const amEnd = verticalStack
          ? { x: maintain.left + 16, y: maintain.top }
          : { x: maintain.left + maintain.width * 0.25, y: maintain.top };
        const pmStart = verticalStack
          ? { x: pay.left + pay.width * 0.78, y: pay.bottom }
          : { x: pay.left + pay.width * 0.38, y: pay.bottom };
        const pmEnd = {
          x: maintain.left + maintain.width * 0.75,
          y: maintain.top,
        };
        const renewalTop = Math.max(12, pay.top - (verticalStack ? 31 : 48));
        const recoveryEdge = verticalStack
          ? width - 20
          : Math.min(
              width - 58,
              Math.max(pay.right, maintain.right) + Math.max(36, width * 0.035),
            );

        const ap = cubicConnector(apStart,
          verticalStack ? { x: apStart.x, y: (apStart.y + apEnd.y) / 2 } : { x: (apStart.x + apEnd.x) / 2, y: apStart.y },
          verticalStack ? { x: apEnd.x, y: (apStart.y + apEnd.y) / 2 } : { x: (apStart.x + apEnd.x) / 2, y: apEnd.y }, apEnd);
        const am = cubicConnector(amStart,
          verticalStack ? { x: sideRouteLeft, y: amStart.y + 24 } : { x: amStart.x, y: (amStart.y + amEnd.y) / 2 },
          verticalStack ? { x: sideRouteLeft, y: amEnd.y - 24 } : { x: amEnd.x, y: (amStart.y + amEnd.y) / 2 }, amEnd);
        const pm = cubicConnector(pmStart, { x: pmStart.x, y: (pmStart.y + pmEnd.y) / 2 },
          { x: pmEnd.x, y: (pmStart.y + pmEnd.y) / 2 }, pmEnd);
        const pp = cubicConnector(
          { x: pay.right - (verticalStack ? 14 : Math.min(34, pay.width * 0.12)), y: pay.top },
          { x: verticalStack ? pay.right - 14 : pay.right + Math.min(44, width * 0.035), y: renewalTop },
          { x: verticalStack ? pay.right - 92 : pay.left - Math.min(44, width * 0.035), y: renewalTop },
          { x: verticalStack ? pay.right - 92 : pay.left + Math.min(34, pay.width * 0.12), y: pay.top });
        const mpStart = {
          x: maintain.right - Math.min(28, maintain.width * 0.1),
          y: maintain.bottom,
        };
        const mpEnd = {
          x: pay.right - Math.min(22, pay.width * 0.08),
          y: pay.bottom,
        };
        const mp = cubicConnector(mpStart,
          { x: recoveryEdge, y: verticalStack ? mpStart.y + 26 : Math.min(height - 16, mpStart.y + 34) },
          { x: recoveryEdge, y: mpEnd.y + (verticalStack ? -26 : 58) }, mpEnd);

        setConnectorLayout({
          width,
          height,
          paths: { ap: ap.path, am: am.path, pp: pp.path, pm: pm.path, mp: mp.path },
          chips: {
            ap: ap.label, am: am.label, pp: pp.label, pm: pm.label, mp: mp.label,
          },
        });
      });
    };

    const observer = new ResizeObserver(measure);
    [map, acquisition, paid, maintenance].forEach((element) =>
      observer.observe(element),
    );
    window.addEventListener("resize", measure);
    measure();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [smartMode, compact]);

  const focusStage = (id: ServiceStageId) => {
    if (smartMode)
      onFocus?.({
        kind: "stage",
        id,
        title: {
          acquisition: "第一次免费体验",
          paid: "订阅服务",
          maintenance: "停止付费后",
        }[id],
      });
    else onStage?.(id);
  };
  const focusTransition = (id: ServiceTransitionId, title: string) => {
    if (smartMode) onFocus?.({ kind: "transition", id, title });
    else onTransition?.(id);
  };
  return (
    <section
      className={`service-blueprint-pane ${smartMode ? "smart-blueprint-pane" : ""} ${compact ? "compact-blueprint" : ""}`}
    >
      {!compact && <div className="service-pane-head">
        <div>
          <span>{smartMode ? "商业模式草案" : "服务模式 · 随对话更新"}</span>
          <strong>
            {blueprint.valueStatement ||
              (smartMode
                ? "正在结合前面的讨论规划这套服务"
                : "先从用户第一次体验开始")}
          </strong>
        </div>
      </div>}
      {!compact && !smartMode && (
        <div className="service-blueprint-status">
          <span>
            <i className="status-default" />
            系统默认
          </span>
          <span>
            <i className="status-suggested" />
            AI 建议
          </span>
          <span>
            <i className="status-confirmed" />
            创作者确认
          </span>
        </div>
      )}
      <div
        ref={mapRef}
        className={`service-map ${connectorLayout ? "connectors-ready" : ""}`}
        aria-label="三阶段服务蓝图"
      >
        <svg
          className="service-transition-lines"
          viewBox={`0 0 ${connectorLayout?.width || 1} ${connectorLayout?.height || 1}`}
          preserveAspectRatio="none"
          aria-hidden="true"
          style={{ "--service-arrow": `url(#${arrowId})` } as CSSProperties}
        >
          <defs>
            <marker
              id={arrowId}
              markerWidth="8"
              markerHeight="8"
              refX="7"
              refY="4"
              orient="auto"
            >
              <path d="M0,0 L8,4 L0,8 Z" />
            </marker>
          </defs>
          <path
            className="line-acquisition-paid"
            d={connectorLayout?.paths.ap || ""}
          />
          <path
            className="line-acquisition-maintenance"
            d={connectorLayout?.paths.am || ""}
          />
          <path
            className="line-paid-maintenance"
            d={connectorLayout?.paths.pm || ""}
          />
          <path
            className="line-maintenance-paid system-line"
            d={connectorLayout?.paths.mp || ""}
          />
          <path
            className="line-paid-renewal"
            d={connectorLayout?.paths.pp || ""}
          />
        </svg>
        <StageCard
          cardRef={acquisitionRef}
          stage={acquisitionStage}
          compact={compact}
          core={acquisitionCore}
          label={smartMode ? "第一次免费体验" : undefined}
          showStatus={!smartMode}
          selected={
            selectedStage === "acquisition" ||
            visibleProposal?.phase === "acquisition"
          }
          onClick={() => focusStage("acquisition")}
        />
        <StageCard
          cardRef={paidRef}
          stage={paidStage}
          compact={compact}
          core={paidCore}
          label={smartMode ? "订阅服务" : undefined}
          showStatus={!smartMode}
          selected={
            selectedStage === "paid" || visibleProposal?.phase === "paid"
          }
          onClick={() => focusStage("paid")}
        />
        <StageCard
          cardRef={maintenanceRef}
          stage={blueprint.stages.maintenance}
          compact={compact}
          core={maintenanceCore}
          label={smartMode ? "停止付费后" : undefined}
          showStatus={!smartMode}
          selected={selectedStage === "maintenance"}
          onClick={() => focusStage("maintenance")}
        />
        <button
          style={connectorChipStyle(connectorLayout, "ap")}
          className={`transition-chip transition-ap ${selectedTransition === "acquisition-paid" ? "selected" : ""}`}
          onClick={() => focusTransition("acquisition-paid", "体验后订阅")}
        >
          体验后订阅 <ArrowRight size={13} />
        </button>
        <button
          style={connectorChipStyle(connectorLayout, "am")}
          className={`transition-chip transition-am ${selectedTransition === "acquisition-maintenance" ? "selected" : ""}`}
          onClick={() => focusTransition("acquisition-maintenance", "暂不订阅")}
        >
          未订阅 <ArrowRight size={13} />
        </button>
        <button
          style={connectorChipStyle(connectorLayout, "pp")}
          className={`transition-chip transition-pp ${selectedTransition === "paid-paid" ? "selected" : ""}`}
          onClick={() => focusTransition("paid-paid", "续费")}
        >
          续费 <ArrowRight size={13} />
        </button>
        <button
          style={connectorChipStyle(connectorLayout, "pm")}
          className={`transition-chip transition-pm ${selectedTransition === "paid-maintenance" ? "selected" : ""}`}
          onClick={() => focusTransition("paid-maintenance", "不再续约")}
        >
          不再续约 <ArrowRight size={13} />
        </button>
        <button
          style={connectorChipStyle(connectorLayout, "mp")}
          className={`transition-chip transition-mp system-transition ${selectedTransition === "maintenance-paid" ? "selected" : ""}`}
          onClick={() => focusTransition("maintenance-paid", "恢复订阅")}
        >
          恢复订阅 <ArrowRight size={13} />
        </button>
      </div>
      {!compact && <div className="service-blueprint-summary">
        <div>
          <span>订阅与价格</span>
          <strong>
            {subscriptionPrice(blueprint.price, blueprint.billingCycle)}
          </strong>
        </div>
        <div>
          <span>周期结果</span>
          <strong>{blueprint.deliveries || "待讨论"}</strong>
        </div>
        <div>
          <span>呈现方式</span>
          <strong>
            {blueprint.experienceMode === "custom-component"
              ? `对话 + ${blueprint.customComponentDescription || "待描述组件"}`
              : blueprint.widget || "待选择"}
          </strong>
        </div>
        <div>
          <span>人工介入</span>
          <strong>{blueprint.humanReview ? "创作者复核" : "默认不介入"}</strong>
        </div>
      </div>}
    </section>
  );
}
