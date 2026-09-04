import { z } from "zod";
import { SOURCE_KINDS } from "./rules.js";
const stage = z.enum(["definition", "knowledge", "methods", "service"]);
const ref = z
    .object({
    type: z.enum(["input", "artifact", "source"]),
    id: z.string().min(1),
    hash: z.string().length(64),
    quote: z.string().optional(),
    locator: z.string().optional(),
})
    .strict();
const target = z
    .object({
    scope: z.enum(["object", "booklet"]),
    stage,
    objects: z
        .array(z.object({ id: z.string(), hash: z.string().length(64) }).strict())
        .min(1),
})
    .strict();
export const resultSchema = z
    .object({
    intent: z.enum([
        "answer",
        "supplement",
        "revise",
        "confirm",
        "explain",
        "pause",
        "skip",
        "correct_question",
        "resume",
    ]),
    assessments: z
        .array(z
        .object({
        targetId: z.string(),
        status: z.enum([
            "unstarted",
            "partial",
            "sufficient",
            "uncertain",
            "skipped",
            "exhausted",
            "conflict",
        ]),
        summary: z.string().max(6000),
        gaps: z.array(z.string()),
        evidence: z.array(ref),
    })
        .strict())
        .optional(),
    artifacts: z
        .array(z
        .object({
        id: z.string(),
        stage,
        kind: z.enum([
            "chapter",
            "hypothesis",
            "scenario",
            "blueprint",
            "transition",
        ]),
        title: z.string().min(1).max(200),
        markdown: z.string().min(1).max(16000),
        data: z.record(z.string(), z.unknown()).optional().describe('服务蓝图的 billingCycle 使用 {count:正整数,unit:"day"|"week"|"month"|"year"}，price 为整个订阅周期的价格，cadence 为独立的交付频率。未讨论时长可省略为待定；monthly 兼容已有月度时长。conversationLimit 固定为 unlimited，真人次数和时长另写 humanConversationLimit；maintenanceContract.basicConversation 为 true，allowedQuestions 说明基础对话范围。免费范围和时长由创作者定义，可多天跟进，semanticChecks.freeScopeAgreed 引用真实依据。'),
        evidence: z.array(ref).min(1),
        dependencies: z.array(ref),
        unresolved: z.array(z.string()),
    })
        .strict())
        .max(27)
        .optional(),
    confirmation: z
        .object({
        target,
        decision: z.enum(["confirmed", "accepted", "rejected"]),
        evidence: z.array(ref).min(1),
    })
        .strict()
        .optional(),
    majorChange: z
        .object({
        affectedTargets: z.array(z.string()).min(1),
        evidence: z.array(ref).min(1),
        reason: z.enum(["positioning", "audience", "core_task"]),
    })
        .strict()
        .optional(),
    sourcePlan: z
        .object({
        requiredKinds: z.array(z.enum([...SOURCE_KINDS, "xiaohongshu"])),
        sourceIds: z.array(z.string()),
        discoveryClosed: z.boolean(),
    })
        .strict()
        .optional(),
    sourceVersions: z
        .array(z.object({ id: z.string(), version: z.string() }).strict())
        .optional(),
    serviceMode: z.enum(["smart", "guided"]).optional(),
    serviceModelExplained: z.boolean().optional(),
    delivery: z
        .object({
        text: z.string().min(1).max(6400),
        mode: z
            .enum(["ordinary", "example", "transition", "explanation", "booklet"])
            .optional(),
        questionTargetId: z.string().optional(),
        confirmationObjectIds: z.array(z.string()).min(1).optional(),
        confirmationScope: z.enum(["object", "booklet"]).optional(),
    })
        .strict(),
})
    .strict();
export const resultJsonSchema = z.toJSONSchema(resultSchema);
