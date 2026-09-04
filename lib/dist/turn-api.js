import { sourcePolicy } from "./source-policy.js";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { check, hash, immutable, optional, read, safeId } from "./io.js";
import { CARDS, METHOD_SCENARIO_GUIDANCE, ROLE, SERVICE_RULES, SUBSCRIPTION_GUIDANCE } from "./rules.js";
import { continuationOptions } from "./domain.js";
import { resultJsonSchema } from "./schema.js";
import { Workflow } from "./workflow.js";
import { withCompletion } from "./completion.js";
const commitId = (requestId) => `fast_commit_${hash(requestId).slice(0, 28)}`;
const workId = (token) => `fast_work_${hash(token).slice(0, 28)}`;
const CORE = `先理解原话，只问会改变结论的缺口，充分即收敛；不确定、跳过、解释都不等于认可。每轮最多一个核心问题，纯答疑不附下一问也不改变内容。记录、修改、认可后，只要还有可推进内容，就在同一 delivery 内简短承接并提出有绑定的下一问或确切版本确认；跨阶段直接接首问，不能只说已保留、接下来聊某主题，或等用户说继续。好的、ok 不代表暂停；只确认上文确切范围，歧义时只澄清当前对象。已有信息不重问，回答可以贡献多个目标。方法候选一次只校准一条；内容充分不等于正式认可，充分且无未决项后用 confirmationObjectIds 展示当前候选并明确询问确认，不再用 H 目标继续采访或重置次数。基础场景先听创作者判断，再整理。引导动线保留规则中的两段式例外。创作者明确修订直接改稿；一句话修改加确认先修改，再展示新版等待确认。确认必须绑定实际已展示的对象、摘要和本轮原话，不扩大范围。阶段草稿可带未决项，硬门槛未通过不能正式确认。改变定位、人群、核心任务只重访受影响目标，其他情况不重置次数。完整资料、旧版本与引用按需读取，不以摘要代替未知原文。保持专业自然，接住具体场景，举例标明假设且不暗示答案。用户想停即暂停；确实无可推进内容时说清具体缺口和恢复条件，不能虚构完成或默认采纳。工具故障与状态追问不是采访答疑：执行允许的恢复和重试后再报告结果，不能只承诺修复就结束，也不能声称不存在的后台工作。`;
export function stageRules(stages) {
    const path = fileURLToPath(new URL("../rules/interview.md", import.meta.url));
    const book = readFileSync(path, "utf8");
    const sections = [...book.matchAll(/^## (\d+)\.[\s\S]*?(?=^## \d+\.|$(?![\s\S]))/gm)];
    const numbers = new Set([
        8,
        ...stages.map((s) => ({ definition: 4, knowledge: 5, methods: 6, service: 7 })[s]),
    ]);
    const completion = "四册正式确认且门槛通过后，自动保存本地四册、创作手册、服务图与来源版本记录。依据 completion.message 和 completion.manualPath 说明真实结果并提供查看入口；生成失败时执行 finalize 重试，不重新采访或扩大用户确认。不默认下载 ZIP，不调用开发 CLI，不立即开启优化采访。";
    const text = [CORE, completion, ...sections.filter((m) => numbers.has(Number(m[1]))).map((m) => m[0])].join("\n\n");
    return { digest: hash(text), text, fullRulebookRef: path };
}
// A transport projection only. Immutable full context and the original schema remain authoritative.
export function compactWork(store, directive, sessionId, knownRulesDigest) {
    if (directive.directive !== "host_work")
        return directive;
    const item = directive.workItem;
    const c = read(item.contextRef);
    check(hash(c) === item.contextDigest, "CONTEXT_CHANGED", "工作上下文已改变。");
    const state = c.state;
    const stages = [
        ...new Set(Object.values(c.targetCards).map((v) => v.stage)),
    ];
    const rules = stageRules(stages);
    const replyIds = new Set([
        ...(c.replyTo?.confirmationTarget?.objects ?? []).map((v) => v.id),
        ...(c.input.annotation ? [c.input.annotation.objectId] : []),
    ]);
    const workToken = `work_${hash({ sessionId, stepId: item.stepId, contextDigest: item.contextDigest }).slice(0, 40)}`;
    immutable(store.path("runtime-work", "handles", `${workToken}.json`), {
        sessionId,
        requestId: item.requestId,
        item,
    });
    return {
        directive: "host_work",
        workToken,
        requestId: item.requestId,
        work: {
            stepId: item.stepId,
            kind: item.kind,
            objective: item.objective,
            allowedActions: item.allowedActions,
            allowedArtifactPaths: item.allowedArtifactPaths,
            requiredEvidenceRefs: item.requiredEvidenceRefs,
        },
        context: {
            role: ROLE,
            input: c.input,
            replyTo: c.replyTo,
            replyWasPresented: c.replyTo ? store.shown(c.replyTo.id) : false,
            stage: state.stage,
            revision: state.revision,
            paused: state.paused,
            continuation: {
                ...continuationOptions(state, store),
                instruction: "这是当前已保存状态的可选动作；根据本轮结果重新选择。preparation 由宿主先完成，不能作为只报进度就结束的理由。全部为空时核对阶段门槛，具体说明未决事项，不重复盘问。",
            },
            targets: Object.fromEntries(Object.keys(c.targetCards).map((id) => {
                const t = state.targets[id];
                return [
                    id,
                    {
                        ...t,
                        answerInputIds: undefined,
                        answerCount: t.answerInputIds.length,
                        card: CARDS[id] ?? c.targetCards[id],
                    },
                ];
            })),
            priorFacts: Object.values(state.targets)
                .filter((t) => !c.targetCards[t.id] && t.status !== "unstarted")
                .map((t) => ({ id: t.id, status: t.status, summary: t.summary, evidence: t.evidence })),
            artifacts: Object.values(state.artifacts).map((a) => ({
                id: a.id,
                stage: a.stage,
                title: a.title,
                kind: a.kind,
                hash: a.hash,
                dependencies: a.dependencies,
                unresolved: a.unresolved,
                confirmation: state.confirmations
                    .filter((v) => v.objectId === a.id && v.hash === a.hash && !v.invalidatedBy)
                    .at(-1)?.decision,
            })),
            displayedArtifacts: Object.values(state.artifacts).filter((a) => replyIds.has(a.id)),
            sourcePlan: state.sourcePlan,
            sourcePolicy,
            sourceSummaries: c.sourceSummaries,
            serviceMode: state.serviceMode,
            serviceModelExplained: state.serviceModelExplained,
            ...(stages.includes("service") ? { platformRules: SERVICE_RULES } : {}),
            previous: c.previous,
            limits: c.limits,
        },
        rules: {
            digest: rules.digest,
            ...(knownRulesDigest === rules.digest ? { unchanged: true } : { text: rules.text }),
            fullRulebookRef: rules.fullRulebookRef,
        },
        outputContract: {
            schemaDigest: hash(resultJsonSchema),
            schemaRef: item.outputSchemaRef,
            required: ["intent", "delivery"],
            intents: [
                "answer",
                "supplement",
                "revise",
                "confirm",
                "explain",
                "pause",
                "skip",
                "correct_question",
                "resume",
            ],
            assessment: "{targetId,status,summary,gaps:[],evidence:[{type:'input',id,hash,quote}]}；引用本轮 input 或已保存证据。",
            delivery: "{text,mode?,questionTargetId?,confirmationObjectIds?,confirmationScope?}；正常推进必须在 text 内明确提出下一问或版本确认，并绑定对应字段；确认与采访二选一。只有纯答疑、真实暂停、完成或确无可推进内容时才可无绑定。",
            ...(stages.includes("methods") ? { methodScenario: METHOD_SCENARIO_GUIDANCE } : {}),
            ...(stages.includes("service") ? { subscription: SUBSCRIPTION_GUIDANCE } : {}),
            optional: [
                "assessments",
                "artifacts",
                "confirmation",
                "majorChange",
                "sourcePlan",
                "sourceVersions",
                "serviceMode",
                "serviceModelExplained",
            ],
            readMore: "需要产物、确认、重大改向等字段时，schema_read 可按 fields 返回规范；需要历史或正文时 context_read 按 section/path 读取。不修改或重发未变字段。",
        },
        fullContext: {
            stepId: item.stepId,
            contextDigest: item.contextDigest,
            contextRef: item.contextRef,
        },
    };
}
export class TurnAPI {
    store;
    workflow;
    constructor(store, afterHead) {
        this.store = store;
        this.workflow = new Workflow(store, afterHead);
    }
    close() {
        this.workflow.close();
    }
    async next(requestId, sessionId, knownRulesDigest) {
        let d = await this.workflow.next(requestId);
        if (d.directive === "ready_to_commit")
            d = await this.workflow.commit(requestId, commitId(requestId));
        return compactWork(this.store, d, sessionId, knownRulesDigest);
    }
    async begin(args) {
        const session = this.store.requireSession(args.sessionId);
        check(typeof args.clientKey === "string" &&
            args.clientKey.length > 0 &&
            args.clientKey.length <= 256, "INPUT_IDENTITY_REQUIRED", "clientKey 必须是本条消息稳定且唯一的标识。");
        check(typeof args.raw === "string" && args.raw.trim() && args.raw.length <= 200000, "INPUT_SIZE", "原话须为非空文本且不超过200,000字符。");
        const body = {
            sessionId: args.sessionId,
            clientKey: args.clientKey,
            raw: args.raw,
            annotation: args.annotation,
            replyToDeliveryId: args.replyToDeliveryId,
            presentedDeliveryId: args.presentedDeliveryId,
            pipeline: args.pipeline ?? "interview",
            conflictReview: args.conflictReview,
        };
        const path = this.store.path("runtime-work", "begins", `${hash({ sessionId: args.sessionId, clientKey: args.clientKey })}.json`);
        const previous = optional(path);
        check(!previous || previous.digest === hash(body), "IDEMPOTENCY_CONFLICT", "相同消息身份的原话、回复对象或处理范围不同。");
        check(!previous || previous.epoch === session.epoch, "EXECUTION_REPLACED", "旧消息所属执行已被替代，请恢复当前执行。");
        this.store.reconcile();
        if (previous) {
            const receipt = this.store.findReceipt(commitId(previous.requestId));
            if (receipt)
                return withCompletion(this.store, { receipt, ...this.store.deliveryDirective(receipt.deliveryId) });
        }
        if (session.activeRequestId && session.activeRequestId !== previous?.requestId) {
            // This message may revise a completed design; register it before any new handoff.
            const pending = await this.workflow.next(session.activeRequestId, false);
            check(Boolean(pending.receipt), "TURN_ACTIVE", "上一轮尚未完成，请先 turn_resume 或明确取消。", { requestId: session.activeRequestId });
        }
        // Validate identity before accepting a report; never infer presentation from a new answer.
        if (args.presentedDeliveryId && !this.store.shown(args.presentedDeliveryId))
            this.store.presentation(args.presentedDeliveryId, "host_reported");
        const ticket = this.store.reserve(args.sessionId, args.clientKey, args.replyToDeliveryId);
        const requestId = `request_${hash({ inputId: ticket.inputId, epoch: session.epoch }).slice(0, 28)}`;
        immutable(path, {
            digest: hash(body),
            inputId: ticket.inputId,
            requestId,
            epoch: session.epoch,
        });
        this.store.record(args.sessionId, ticket.token, args.raw, args.annotation);
        const d = await this.workflow.prepare(args.sessionId, ticket.inputId, args.pipeline, args.conflictReview);
        return compactWork(this.store, d, args.sessionId, args.knownRulesDigest);
    }
    async finish(args) {
        const h = read(this.store.path("runtime-work", "handles", `${safeId(args.workToken)}.json`));
        const s = this.store.requireSession(args.sessionId);
        check(h.sessionId === s.id && h.item.operationEpoch === s.epoch, "EXECUTION_REPLACED", "工作凭据不属于当前连接或执行代际。");
        const envelope = {
            stepId: h.item.stepId,
            operationId: workId(args.workToken),
            contextDigest: h.item.contextDigest,
            baseRevision: h.item.baseRevision,
            operationEpoch: h.item.operationEpoch,
            output: args.output,
        };
        const operation = optional(this.store.path("runtime-work", "operations", `${envelope.operationId}.json`));
        check(!operation || operation.digest === hash(envelope), "IDEMPOTENCY_CONFLICT", "已接受的工作凭据不能提交不同结果。");
        // HEAD may have committed before the graph checkpoint / response was delivered.
        const committed = this.store.findReceipt(commitId(h.requestId));
        if (committed) {
            check(operation, "WORK_NOT_ACCEPTED", "本工作项尚未接受，不能采用其他提交回执。");
            return this.workflow.commit(h.requestId, commitId(h.requestId));
        }
        const next = await this.workflow.complete(h.requestId, envelope);
        return next.directive === "ready_to_commit"
            ? this.workflow.commit(h.requestId, commitId(h.requestId))
            : compactWork(this.store, next, s.id, args.knownRulesDigest);
    }
}
