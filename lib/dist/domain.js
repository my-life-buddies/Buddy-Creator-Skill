import { CARDS, CHAPTERS, SERVICE_RULES, STAGES } from "./rules.js";
import { subscriptionPeriod } from "./subscription.js";
import { serviceConversationIssues } from "./service-policy.js";
import { BuddyError, check, hash } from "./io.js";
export function confirmed(state, objectId, decision = "confirmed") {
    const artifact = state.artifacts[objectId];
    return Boolean(artifact &&
        state.confirmations.some((c) => c.objectId === objectId &&
            c.hash === artifact.hash &&
            !c.invalidatedBy &&
            c.decision === decision));
}
export function bookIds(stage) {
    return CHAPTERS[stage].map((_, i) => `${stage}.${i + 1}`);
}
export function bookConfirmed(state, stage) {
    return bookIds(stage).every((id) => confirmed(state, id));
}
export function verifyRef(store, state, ref) {
    let text = "";
    if (ref.type === "input") {
        const input = store.input(ref.id);
        check(input.hash === ref.hash, "EVIDENCE_VERSION", "原话摘要不匹配。");
        text = input.raw;
        check(ref.quote?.trim(), "EVIDENCE_QUOTE", "原话证据必须包含精确引用。");
    }
    else if (ref.type === "artifact") {
        const a = state.artifacts[ref.id];
        check(a?.hash === ref.hash, "EVIDENCE_VERSION", "引用的产物版本不匹配。", {
            id: ref.id,
        });
        text = a.markdown;
    }
    else {
        const source = store.source(ref.id, state.sources[ref.id]?.version);
        check(source.status === "ready", "SOURCE_NOT_READY", "引用的来源尚未真实可用。");
        const chunk = source.chunks.find((c) => c.hash === ref.hash && c.locator === ref.locator);
        check(chunk && hash(chunk.text) === chunk.hash, "EVIDENCE_LOCATOR", "来源引用必须指向确切的全文块及位置。");
        text = chunk.text;
    }
    if (ref.quote)
        check(text.includes(ref.quote), "EVIDENCE_QUOTE", "引用与已保存原文不一致。", { id: ref.id });
}
function inputEvidence(store, state, input, refs) {
    check(refs.some((r) => r.type === "input" && r.id === input.id && r.quote?.trim()), "USER_EVIDENCE_REQUIRED", "此动作必须引用本轮用户原话。");
    refs.forEach((r) => verifyRef(store, state, r));
}
export function gates(state, store, stage) {
    if (stage === "definition")
        return Object.entries(CARDS)
            .filter(([, c]) => c.stage === stage)
            .map(([id, c]) => ({
            label: c.title,
            pass: ["sufficient", "uncertain", "skipped", "exhausted"].includes(state.targets[id].status),
        }));
    if (stage === "knowledge") {
        const sources = state.sourcePlan.sourceIds.map((id) => {
            try {
                return store.source(id, state.sources[id]?.version);
            }
            catch {
                return undefined;
            }
        });
        return [
            ...["K01", "K03", "K04"].map((id) => ({
                label: CARDS[id].title,
                pass: ["sufficient", "uncertain", "skipped", "exhausted"].includes(state.targets[id].status),
            })),
            { label: "来源发现已明确结束", pass: state.sourcePlan.discoveryClosed },
            {
                label: "导入计划有实际内容",
                pass: sources.length > 0 && state.sourcePlan.requiredKinds.length > 0,
            },
            {
                label: "全部所选来源真实可用",
                pass: sources.every((s) => s?.status === "ready" && s.chunks.length > 0),
            },
            {
                label: "每类必需来源有可用内容",
                pass: state.sourcePlan.requiredKinds.every((k) => sources.some((s) => s?.kind === k && s.status === "ready")),
            },
        ];
    }
    if (stage === "methods") {
        const hypotheses = Object.values(state.artifacts).filter((a) => a.kind === "hypothesis");
        return [
            {
                label: "3—4 个方法候选已全部处理",
                pass: hypotheses.length >= 3 &&
                    hypotheses.length <= 4 &&
                    new Set(hypotheses.map((a) => a.markdown.replace(/\s/g, ""))).size ===
                        hypotheses.length &&
                    hypotheses.every((a) => confirmed(state, a.id, "accepted") ||
                        confirmed(state, a.id, "rejected")),
            },
            {
                label: "至少一个方法获认可",
                pass: hypotheses.some((a) => confirmed(state, a.id, "accepted")),
            },
            ...["M01", "M02", "M03", "M04", "E01", "E02", "E03"].map((id) => ({
                label: CARDS[id].title,
                pass: confirmed(state, `scenario.${id}`),
            })),
        ];
    }
    return serviceGates(state);
}
function serviceRulesMatch(data) {
    return hash(data.platformRules) === hash(SERVICE_RULES);
}
function serviceGates(state) {
    const data = state.artifacts["service.blueprint"]?.data ?? {};
    const stages = (data.stages ?? {});
    const transitions = (data.transitions ?? {});
    const loop = (data.serviceLoop ?? {});
    const contract = (data.acquisitionContract ?? {});
    const attest = (data.semanticChecks ?? {});
    const text = (v) => typeof v === "string" && v.trim().length > 0;
    const list = (v) => Array.isArray(v) && v.length > 0 && v.every(text);
    const known = (key) => attest[key]?.pass === true && Boolean(attest[key]?.evidence?.length);
    const filled = (o, keys) => Boolean(o) && keys.every((k) => text(o[k]));
    return [
        {
            label: "持续价值",
            pass: text(data.valueStatement) &&
                list(data.recurrenceDrivers) &&
                list(data.renewalEvidence) &&
                text(loop.nextCycleUpdate),
        },
        {
            label: "完整服务循环",
            pass: filled(loop, [
                "trigger",
                "requiredInput",
                "decision",
                "action",
                "result",
                "feedback",
                "nextCycleUpdate",
            ]) && known("coherentLoop"),
        },
        {
            label: "付费可交付",
            pass: filled(stages.paid, ["result", "service", "limit"]) &&
                text(data.deliveries) &&
                known("paidDeliverable"),
        },
        {
            label: "免费体验范围明确",
            pass: filled(contract, [
                "trigger",
                "requiredInput",
                "completionCriteria",
                "conversionBridge",
            ]) &&
                list(contract.includedSteps) &&
                Array.isArray(contract.excludedSteps) && contract.excludedSteps.every(text) &&
                known("freeScopeAgreed"),
        },
        {
            label: "停付边界",
            pass: filled(stages.maintenance, ["service", "limit"]) &&
                data.maintenanceContract?.basicConversation === true &&
                text(data.maintenanceContract?.allowedQuestions) &&
                known("maintenanceBoundary"),
        },
        {
            label: "五条动线",
            pass: [
                "acquisition-paid",
                "acquisition-maintenance",
                "paid-paid",
                "paid-maintenance",
                "maintenance-paid",
            ].every((id) => filled(transitions[id], [
                "trigger",
                "rightsChange",
                "dataInheritance",
                "message",
            ])) &&
                known("transitionsConfirmed") &&
                (state.serviceMode !== "guided" ||
                    [
                        "acquisition-paid",
                        "acquisition-maintenance",
                        "paid-paid",
                        "paid-maintenance",
                    ].every((id) => confirmed(state, `transition.${id}`) &&
                        hash(state.artifacts[`transition.${id}`]?.data) ===
                            hash(transitions[id]))),
        },
        { label: "价值后提示付费", pass: known("valueBeforePaywall") },
        {
            label: "创作者复核有产能",
            pass: data.humanReview === false ||
                (data.humanReview === true &&
                    text(data.reviewCapacity) &&
                    known("creatorCapacity")),
        },
        {
            label: "单档订阅契约",
            pass: Boolean(subscriptionPeriod(data.billingCycle)) &&
                serviceRulesMatch(data) &&
                data.multiUser === false &&
                (typeof data.price === "string" || typeof data.price === "number") &&
                Number.isFinite(Number(data.price)) && Number(data.price) > 0 &&
                text(data.cadence) &&
                data.conversationLimit === "unlimited" &&
                text(data.toolLimit) &&
                (data.experienceMode === "conversation" ||
                    (data.experienceMode === "custom-component" &&
                        text(data.customComponentDescription))) &&
                known("executableContract"),
        },
    ];
}
export function canDraft(state, store, stage) {
    return (gates(state, store, stage).every((g) => g.pass) &&
        (stage !== "service" || confirmed(state, "service.blueprint")));
}
function canAsk(state, store, targetId) {
    const card = CARDS[targetId], target = state.targets[targetId];
    check(card && target, "UNKNOWN_TARGET", "未知采访目标。", { targetId });
    check(card.stage === state.stage, "STAGE_SCOPE", "不能提前采访其他阶段。");
    if (targetId === "K02")
        check(!state.sourcePlan.discoveryClosed, "SOURCE_DISCOVERY_CLOSED", "创作者已明确结束本轮来源发现，不应继续追问。");
    check(!["sufficient", "skipped", "uncertain", "exhausted"].includes(target.status) && target.answerInputIds.length < card.maxAnswers, "FOLLOWUP_CLOSED", "这个目标已经收敛、被跳过或达到本轮上限，不应重复追问。", { targetId });
    if (card.stage === "methods" && targetId.startsWith("H")) {
        const objectId = `hypothesis.H${Number(targetId.slice(1))}`;
        check(state.artifacts[objectId] &&
            !confirmed(state, objectId, "accepted") &&
            !confirmed(state, objectId, "rejected"), "HYPOTHESIS_HANDLED", "该方法候选尚未生成或已处理完成。");
    }
    if (card.stage === "methods" && !targetId.startsWith("H")) {
        const h = Object.values(state.artifacts).filter((a) => a.kind === "hypothesis");
        check(h.length >= 3 &&
            h.length <= 4 &&
            h.every((a) => confirmed(state, a.id, "accepted") ||
                confirmed(state, a.id, "rejected")) &&
            h.some((a) => confirmed(state, a.id, "accepted")), "METHOD_HYPOTHESES", "方法候选尚未完成校准。");
        if (targetId.startsWith("E"))
            check(["M01", "M02", "M03", "M04"].every((id) => confirmed(state, `scenario.${id}`)), "BASE_SCENARIOS", "先完成四个基础场景。");
        check(!confirmed(state, `scenario.${targetId}`), "SCENARIO_HANDLED", "这个场景已经有效确认，不应重复采访。");
    }
    if (targetId === "R00")
        check(STAGES.every((s) => bookConfirmed(state, s)), "REVISION_ENTRY", "先完成当前手册。");
    if (card.stage === "service" && !["S00", "R00"].includes(targetId))
        check(state.serviceModelExplained && state.serviceMode, "SERVICE_INTRO", "先解释固定服务模式，并由创作者选择规划方式。");
}
export function validateDelivery(result) {
    const d = result.delivery, mode = d.mode ?? "ordinary", length = [...d.text].length, questions = (d.text.match(/[?？]/g) ?? []).length;
    check(!(d.questionTargetId && d.confirmationObjectIds), "ONE_REPLY_TARGET", "每轮只保留一个问题或确认对象。");
    check(questions === 0 || d.questionTargetId || d.confirmationObjectIds, "QUESTION_ID_REQUIRED", "对话中的问题必须绑定实际待回答对象，不能绕过采访计数。");
    if (d.confirmationObjectIds)
        check(questions <= 1, "ONE_REPLY_TARGET", "确认时最多提出一个核心问题。");
    if (d.questionTargetId) {
        if (d.questionTargetId.startsWith("T."))
            check(mode === "transition", "TRANSITION_STYLE", "四条服务动线的采访必须使用两段情境问法。");
        if (mode === "transition") {
            const parts = d.text.trim().split(/\n\s*\n/);
            check(parts.length === 2 &&
                /^(接下来我们|这一轮我们|现在我们)/.test(parts[0]) &&
                parts[1].startsWith("比如，") &&
                questions === 2 &&
                length >= 70 &&
                length <= 160, "TRANSITION_STYLE", "服务动线问法需要两段、两个问号、70—160字，第二段以“比如，”开头。");
        }
        else
            check(questions === 1 && length <= (mode === "example" ? 180 : 100), "QUESTION_STYLE", "每轮一个核心问题；普通问法不超过100字，结合场景不超过180字。");
    }
    else if (result.intent === "explain")
        check(!d.confirmationObjectIds &&
            questions === 0 &&
            length >= 80 &&
            length <= 220, "EXPLANATION_STYLE", "解释使用80—220字，不顺带提出采访问题或确认。");
}
// Sufficient content can be ratified without reopening its interview budget.
// This only permits showing the current version; acceptance still requires a
// later input replying to that shown version, as checked by reduce below.
function canRatifyHypothesis(state, a) {
    const target = state.targets[`H0${a.id.slice(-1)}`];
    return a.kind === "hypothesis" && a.stage === state.stage &&
        target?.status === "sufficient" && !target.gaps.length && !a.unresolved.length &&
        !confirmed(state, a.id, "accepted") && !confirmed(state, a.id, "rejected");
}
export function continuationOptions(state, store) {
    const questionTargets = [], confirmationObjects = [], preparation = [];
    if (state.paused || STAGES.every((stage) => bookConfirmed(state, stage)))
        return { questionTargets, confirmationObjects, preparation };
    for (const [id, card] of Object.entries(CARDS)) {
        if (card.stage !== state.stage)
            continue;
        try {
            canAsk(state, store, id);
            questionTargets.push(id);
        }
        catch (error) {
            if (!(error instanceof BuddyError))
                throw error;
        }
    }
    const draftable = canDraft(state, store, state.stage);
    for (const a of Object.values(state.artifacts)) {
        if (a.stage !== state.stage || a.unresolved.length)
            continue;
        if (a.kind === "hypothesis") {
            if (canRatifyHypothesis(state, a) || questionTargets.includes(`H0${a.id.slice(-1)}`))
                confirmationObjects.push(a.id);
        }
        else if (!confirmed(state, a.id) &&
            (a.kind !== "chapter" || draftable) &&
            (a.kind !== "blueprint" || serviceGates(state).every((g) => g.pass))) {
            confirmationObjects.push(a.id);
        }
    }
    if (draftable && bookIds(state.stage).some((id) => {
        const a = state.artifacts[id];
        return !a || a.unresolved.some((item) => item.startsWith("阶段待完成：") || item === "服务蓝图待确认");
    }))
        preparation.push(`booklet.${state.stage}`);
    if (state.stage === "methods" &&
        Object.values(state.artifacts).filter((a) => a.kind === "hypothesis").length < 3)
        preparation.push("method_hypotheses");
    return { questionTargets, confirmationObjects, preparation };
}
function validateContinuation(state, store, result) {
    if (result.intent === "explain" || state.paused ||
        result.delivery.questionTargetId || result.delivery.confirmationObjectIds)
        return;
    const options = continuationOptions(state, store);
    check(!options.questionTargets.length && !options.confirmationObjects.length && !options.preparation.length, "NEXT_ACTION_REQUIRED", "访谈还有可推进内容，不能只回复已更新或已保留。请在本次 delivery 内接一个有绑定的下一问或版本确认；需要整理产物时先完成整理再提交。不要求用户说继续，不扩大确认范围。", { ...options, recovery: "修正当前工作结果后重试；不新增用户输入，不修改已经成功的前置工作。" });
}
export function reduce(store, base, input, result, requestId) {
    validateDelivery(result);
    const state = structuredClone(base);
    const impacted = new Set();
    const substantive = Boolean(result.assessments?.length ||
        result.artifacts?.length ||
        result.confirmation ||
        result.majorChange ||
        result.sourcePlan ||
        result.sourceVersions?.length ||
        result.serviceMode ||
        result.serviceModelExplained);
    check(result.intent !== "explain" || !substantive, "EXPLANATION_MUTATION", "解释不能改动产物、确认、来源计划或采访状态。");
    check(!result.artifacts?.some((a) => result.confirmation?.target.objects.some((o) => o.id === a.id)), "UNSEEN_CONFIRMATION", "同一句修改和确认先保存修改，新版展示后再确认。");
    if (result.majorChange) {
        check(result.intent === "revise", "MAJOR_CHANGE_INTENT", "只有明确改向的修订才开启新访谈轮。");
        inputEvidence(store, base, input, result.majorChange.evidence);
        const cycleId = `cycle_${hash(input.id).slice(0, 24)}`, affected = [...new Set(result.majorChange.affectedTargets)];
        for (const targetId of affected) {
            if (/^D0[1-6]$/.test(targetId))
                impacted.add(`definition.${Number(targetId.slice(1))}`);
            else
                for (const a of Object.values(state.artifacts))
                    if (a.stage === CARDS[targetId]?.stage)
                        impacted.add(a.id);
        }
        check(affected.every((id) => CARDS[id]), "UNKNOWN_TARGET", "改向包含未知目标。");
        if (!state.cycles.some((c) => c.id === cycleId)) {
            state.cycles.push({
                id: cycleId,
                inputId: input.id,
                affected,
                previous: affected.map((id) => structuredClone(state.targets[id])),
            });
            for (const id of affected)
                state.targets[id] = {
                    ...state.targets[id],
                    cycleId,
                    status: "unstarted",
                    answerInputIds: [],
                    gaps: [],
                };
        }
    }
    const answeredDelivery = input.replyToDeliveryId
        ? store.delivery(input.replyToDeliveryId)
        : undefined;
    if (["answer", "skip"].includes(result.intent) &&
        answeredDelivery?.question &&
        !state.answeredInputs.includes(input.id)) {
        const { targetId, cycleId } = answeredDelivery.question, target = state.targets[targetId];
        check(target.cycleId === cycleId, "OLD_QUESTION", "输入指向旧访谈轮，请按修订或补充重新准备。");
        target.answerInputIds.push(input.id);
        state.answeredInputs.push(input.id);
        if (result.intent === "skip")
            target.status = "skipped";
        else if (target.answerInputIds.length >= CARDS[targetId].maxAnswers)
            target.status = "exhausted";
    }
    for (const assessment of result.assessments ?? []) {
        const target = state.targets[assessment.targetId];
        check(target, "UNKNOWN_TARGET", "未知采访目标。");
        check(CARDS[target.id].stage === base.stage ||
            result.intent === "revise" ||
            result.intent === "supplement", "STAGE_SCOPE", "跨阶段内容应保存为线索，不应提前完成采访。");
        assessment.evidence.forEach((ref) => verifyRef(store, base, ref));
        if (assessment.status === "sufficient")
            check(assessment.evidence.length, "EVIDENCE_REQUIRED", "充分性结论必须有原话或已确认内容依据。");
        if (["skipped", "uncertain"].includes(assessment.status))
            inputEvidence(store, base, input, assessment.evidence);
        target.summary = assessment.summary;
        target.gaps = assessment.gaps;
        target.evidence = assessment.evidence;
        const priorStatus = target.status;
        target.status =
            ["skipped", "uncertain"].includes(priorStatus) &&
                assessment.status !== "sufficient"
                ? priorStatus
                : assessment.status;
        if (target.answerInputIds.length >= CARDS[target.id].maxAnswers &&
            !["sufficient", "skipped", "uncertain"].includes(target.status))
            target.status = "exhausted";
    }
    if (result.sourcePlan) {
        inputEvidence(store, base, input, [
            { type: "input", id: input.id, hash: input.hash, quote: input.raw },
        ]);
        state.sourcePlan = result.sourcePlan;
    }
    for (const source of result.sourceVersions ?? []) {
        const s = store.source(source.id, source.version);
        check(s.status === "ready" && s.chunks.length, "SOURCE_NOT_READY", "来源未完成解析，不能纳入正式知识。");
        state.sources[s.id] = { version: s.version, kind: s.kind };
    }
    if (result.serviceModelExplained)
        state.serviceModelExplained = true;
    if (result.serviceMode) {
        check(state.serviceModelExplained, "SERVICE_INTRO", "先解释固定服务模式。");
        state.serviceMode = result.serviceMode;
    }
    if (result.intent === "pause")
        state.paused = true;
    if (result.intent === "resume")
        state.paused = false;
    if (result.confirmation) {
        const c = result.confirmation;
        inputEvidence(store, base, input, c.evidence);
        check(answeredDelivery?.confirmationTarget && store.shown(answeredDelivery.id), "CONFIRMATION_NOT_SHOWN", "没有可核对的已展示确认对象。请先展示确切版本。");
        const shown = answeredDelivery.confirmationTarget;
        check(c.target.stage === shown.stage &&
            c.target.objects.every((o) => shown.objects.some((s) => s.id === o.id && s.hash === o.hash)), "CONFIRMATION_SCOPE", "确认不能扩大到未展示的对象。");
        if (c.target.scope === "booklet")
            check(shown.scope === "booklet" &&
                hash(c.target.objects) === hash(shown.objects), "CONFIRMATION_SCOPE", "整册确认需要明确展示完整手册。");
        for (const object of c.target.objects) {
            const a = state.artifacts[object.id];
            check(a?.hash === object.hash && !a.unresolved.length, "CONFIRMATION_STALE", "对象已修改或仍有未决事项，不能确认。");
            if (a.kind === "chapter")
                check(canDraft(state, store, a.stage), "STAGE_GATES", "当前手册硬门槛未通过。");
            if (a.kind === "blueprint")
                check(serviceGates(state).every((g) => g.pass), "SERVICE_GATES", "服务蓝图还有未通过的规则。", { gates: serviceGates(state) });
            check(a.kind === "hypothesis"
                ? ["accepted", "rejected"].includes(c.decision)
                : c.decision === "confirmed", "DECISION_SCOPE", "认可方法假设与确认正式产物不能混用。");
            const record = {
                id: `confirmation_${hash({ input: input.id, object, c: c.decision }).slice(0, 24)}`,
                objectId: a.id,
                hash: a.hash,
                inputId: input.id,
                deliveryId: answeredDelivery.id,
                decision: c.decision,
                evidence: c.evidence,
            };
            if (!state.confirmations.some((existing) => existing.id === record.id))
                state.confirmations.push(record);
        }
    }
    state.stage =
        STAGES.find((stage) => !bookConfirmed(state, stage)) ?? "service";
    const changed = new Set(impacted);
    for (const proposal of result.artifacts ?? []) {
        const patch = structuredClone(proposal);
        check(STAGES.indexOf(patch.stage) <= STAGES.indexOf(state.stage), "STAGE_SCOPE", "上游手册尚未确认，不能生成后续阶段产物。");
        if (patch.kind === "chapter") {
            check(bookIds(patch.stage).includes(patch.id), "CHAPTER_SCHEMA", "手册章节编号不符合固定结构。");
            // Incomplete content remains reviewable; confirmation and export enforce gates.
            const pending = gates(state, store, patch.stage)
                .filter((g) => !g.pass)
                .map((g) => `阶段待完成：${g.label}`);
            if (patch.stage === "service" && !confirmed(state, "service.blueprint"))
                pending.push("服务蓝图待确认");
            patch.unresolved = [...new Set([...patch.unresolved, ...pending])];
        }
        if (patch.kind === "transition") {
            const transitionId = patch.id.slice("transition.".length);
            check(patch.stage === "service" &&
                [
                    "acquisition-paid",
                    "acquisition-maintenance",
                    "paid-paid",
                    "paid-maintenance",
                ].includes(transitionId), "TRANSITION_SCHEMA", "仅四条非默认路径需要单独校准。");
            check(["trigger", "rightsChange", "dataInheritance", "message"].every((k) => typeof patch.data?.[k] === "string" && String(patch.data[k]).trim()), "TRANSITION_INCOMPLETE", "路径需要时点、权益、历史继承和表达四项具体内容。");
        }
        if (patch.kind === "hypothesis")
            check(patch.stage === "methods" && /^hypothesis\.H[1-4]$/.test(patch.id), "HYPOTHESIS_SCHEMA", "方法候选使用 H1—H4，必须为方法阶段。");
        if (patch.kind === "scenario") {
            check(patch.stage === "methods" &&
                /^scenario\.(M0[1-4]|E0[1-3])$/.test(patch.id), "SCENARIO_SCHEMA", "只能使用固定四基础、三拓展维度。");
            if (patch.id.startsWith("scenario.M"))
                check(patch.evidence.some((r) => r.type === "input"), "USER_ANSWERS_FIRST", "基础场景先保存用户实际处理答案。");
        }
        if (patch.kind === "blueprint") {
            check(patch.id === "service.blueprint" && patch.stage === "service", "BLUEPRINT_SCHEMA", "服务蓝图身份不匹配。");
            check(serviceRulesMatch(patch.data ?? {}), "FIXED_SERVICE_RULES", "服务蓝图须使用本轮 platformRules：免费范围由创作者定义、付费AI对话不限次数、维持期保留基础对话。旧规则仅供历史读取，修订时采用当前规则并重新展示确认。");
            const conversationIssues = serviceConversationIssues(patch.data ?? {});
            check(conversationIssues.length === 0, "SERVICE_CONVERSATION_POLICY", conversationIssues.join("；"));
            if (patch.data?.billingCycle !== undefined)
                check(subscriptionPeriod(patch.data.billingCycle), "SUBSCRIPTION_PERIOD", "订阅时长使用 {count:正整数,unit:day|week|month|year}；未讨论时可省略并保留待定，不能用交付频率代替订阅时长。旧 monthly 兼容为1个月。");
            const checks = (patch.data?.semanticChecks ?? {});
            for (const c of Object.values(checks)) {
                check(Array.isArray(c.evidence), "SERVICE_EVIDENCE", "业务判断需要引用依据。");
                c.evidence.forEach((r) => verifyRef(store, base, r));
            }
        }
        patch.evidence.forEach((r) => verifyRef(store, base, r));
        patch.dependencies.forEach((r) => verifyRef(store, base, r));
        for (const ref of [...patch.evidence, ...patch.dependencies])
            if (ref.type === "source")
                check(state.sources[ref.id], "SOURCE_NOT_ADOPTED", "引用的来源必须先绑定真实可用的正式版本。", { id: ref.id });
        const requiredUpstream = {
            definition: [],
            knowledge: ["definition"],
            methods: ["definition", "knowledge"],
            service: ["definition", "knowledge", "methods"],
        };
        for (const stage of requiredUpstream[patch.stage])
            check(patch.dependencies.some((ref) => ref.type === "artifact" && state.artifacts[ref.id]?.stage === stage), "DEPENDENCY_REQUIRED", "下游产物必须记录实际使用的已确认上游依据。", { artifact: patch.id, requiredStage: stage });
        for (const ref of patch.dependencies)
            if (ref.type === "artifact")
                check(confirmed(state, ref.id) || confirmed(state, ref.id, "accepted"), "UNCONFIRMED_DEPENDENCY", "下游依据须来自已确认内容。");
        const digest = hash(patch);
        if (state.artifacts[patch.id]?.hash !== digest)
            changed.add(patch.id);
        state.artifacts[patch.id] = {
            ...patch,
            hash: digest,
            revision: state.artifacts[patch.id]?.hash === digest
                ? state.artifacts[patch.id].revision
                : "",
        };
    }
    // Invalidation follows recorded dependencies, and never silently adopts revised text downstream.
    let added = true;
    while (added) {
        added = false;
        for (const a of Object.values(state.artifacts))
            if (!changed.has(a.id) &&
                a.dependencies.some((r) => r.type === "artifact" && changed.has(r.id))) {
                changed.add(a.id);
                added = true;
            }
    }
    for (const c of state.confirmations)
        if (changed.has(c.objectId) && !c.invalidatedBy)
            c.invalidatedBy = requestId;
    for (const patch of result.artifacts ?? []) {
        if (patch.kind === "scenario" &&
            /^scenario\.M0[1-4]$/.test(patch.id) &&
            patch.data?.capture === "faithful_user_answer") {
            check(result.intent === "answer" &&
                answeredDelivery?.question?.targetId === patch.id.slice(9), "SCENARIO_ANSWER_SCOPE", "只能忠实记录用户刚回答的基础场景。");
            inputEvidence(store, base, input, patch.evidence);
            check(patch.unresolved.length === 0, "SCENARIO_UNRESOLVED", "还有待补事项，不能算有效场景答案。");
            const a = state.artifacts[patch.id];
            state.confirmations.push({
                id: `confirmation_${hash({ input: input.id, object: a.hash }).slice(0, 24)}`,
                objectId: a.id,
                hash: a.hash,
                inputId: input.id,
                deliveryId: answeredDelivery.id,
                decision: "confirmed",
                evidence: patch.evidence,
            });
        }
    }
    // A changed upstream chapter returns the interview to the earliest unconfirmed booklet.
    state.stage =
        STAGES.find((stage) => !bookConfirmed(state, stage)) ?? "service";
    const d = result.delivery;
    let questionTargetId = d.questionTargetId;
    let confirmationTarget;
    if (d.confirmationObjectIds) {
        const artifacts = d.confirmationObjectIds.map((id) => state.artifacts[id]);
        check(artifacts.every(Boolean), "CONFIRMATION_MISSING", "确认对象还未保存。");
        check(!artifacts.some((a) => a.kind === "hypothesis") ||
            artifacts.length === 1, "HYPOTHESIS_ONE_AT_A_TIME", "方法候选一次只展示并校准一条，请选择当前候选，保留其他候选待后续讨论。");
        if (artifacts[0].kind === "hypothesis") {
            const candidate = artifacts[0];
            const targetId = `H0${candidate.id.slice(-1)}`;
            if (state.targets[targetId]?.status === "sufficient") {
                check(candidate.stage === state.stage, "STAGE_SCOPE", "不能提前确认其他阶段的方法候选。");
                check(!state.paused, "PAUSED", "创作者已暂停，本轮不能请求确认。");
                check(!candidate.unresolved.length && !state.targets[targetId].gaps.length, "HYPOTHESIS_UNRESOLVED", "方法候选仍有未决事项，不能请求正式确认。");
                check(canRatifyHypothesis(state, candidate), "HYPOTHESIS_HANDLED", "该方法候选已处理完成。");
            }
            else {
                // Incomplete calibration still counts and cannot evade its answer cap.
                questionTargetId = targetId;
            }
        }
        const stage = artifacts[0].stage;
        check(artifacts.every((a) => a.stage === stage), "CONFIRMATION_SCOPE", "一轮不能跨阶段确认。");
        const scope = d.confirmationScope ?? "object";
        if (scope === "booklet")
            check(hash([...d.confirmationObjectIds].sort()) ===
                hash(bookIds(stage).sort()), "BOOKLET_INCOMPLETE", "整册展示必须包含所有固定章节。");
        confirmationTarget = {
            scope,
            stage,
            objects: artifacts.map((a) => ({ id: a.id, hash: a.hash })),
        };
    }
    check(!state.paused || !questionTargetId, "PAUSED", "创作者已暂停，本轮不能继续采访。");
    if (questionTargetId)
        canAsk(state, store, questionTargetId);
    validateContinuation(state, store, result);
    const delivery = {
        id: `delivery_${hash(requestId).slice(0, 28)}`,
        requestId,
        revision: base.revision,
        text: d.text,
        hash: hash(d.text),
        kind: result.intent === "explain" ? "explanation" : "content",
        inputId: input.id,
        confirmationTarget,
        question: questionTargetId
            ? {
                id: `question_${hash(requestId).slice(0, 24)}`,
                targetId: questionTargetId,
                cycleId: state.targets[questionTargetId].cycleId,
                mode: d.mode === "transition"
                    ? "transition"
                    : d.mode === "example"
                        ? "example"
                        : "ordinary",
            }
            : undefined,
    };
    return { state, delivery, conversationOnly: result.intent === "explain" };
}
