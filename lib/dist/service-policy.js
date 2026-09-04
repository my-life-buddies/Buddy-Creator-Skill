export const SERVICE_STAGE_MEANINGS = {
    acquisition: {
        title: "获客期",
        plain: "先免费体验",
        detail: "让新用户了解搭子能怎样帮忙。体验多久、是否每天跟进和调整方案，由创作者决定。",
    },
    paid: {
        title: "付费期",
        plain: "订阅后持续使用",
        detail: "在约定的订阅期内，与搭子对话不限次数；真人咨询可另行约定次数和时长。",
    },
    maintenance: {
        title: "维持期",
        plain: "暂不订阅，也能基础聊天",
        detail: "免费体验结束后未订阅，或已购服务到期未续费，仍可查看历史、和搭子进行基础对话。",
    },
};
// Validate explicit structured promises; semantic consistency with the prose
// still requires the host's evidence-backed assessment.
export function serviceConversationIssues(data) {
    const issues = [];
    if (data.conversationLimit !== undefined && data.conversationLimit !== "unlimited")
        issues.push('付费期与搭子的 AI 对话不限次数，conversationLimit 必须为 "unlimited"；真人次数与时长写入 humanConversationLimit，交付和工具额度不能限制普通对话。');
    const maintenance = data.maintenanceContract;
    if (maintenance !== undefined) {
        if (!maintenance || typeof maintenance !== "object" || Array.isArray(maintenance))
            issues.push("maintenanceContract 必须说明维持期基础对话能力。");
        else if (maintenance.basicConversation !== undefined &&
            maintenance.basicConversation !== true)
            issues.push("维持期必须保留基础对话，maintenanceContract.basicConversation 只能为 true；不能只留下历史查看或要求重新付费才能聊天。");
    }
    return issues;
}
