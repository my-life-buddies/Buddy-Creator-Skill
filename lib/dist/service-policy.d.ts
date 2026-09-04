export declare const SERVICE_STAGE_MEANINGS: {
    readonly acquisition: {
        readonly title: "获客期";
        readonly plain: "先免费体验";
        readonly detail: "让新用户了解搭子能怎样帮忙。体验多久、是否每天跟进和调整方案，由创作者决定。";
    };
    readonly paid: {
        readonly title: "付费期";
        readonly plain: "订阅后持续使用";
        readonly detail: "在约定的订阅期内，与搭子对话不限次数；真人咨询可另行约定次数和时长。";
    };
    readonly maintenance: {
        readonly title: "维持期";
        readonly plain: "暂不订阅，也能基础聊天";
        readonly detail: "免费体验结束后未订阅，或已购服务到期未续费，仍可查看历史、和搭子进行基础对话。";
    };
};
export declare function serviceConversationIssues(data: Record<string, unknown>): string[];
