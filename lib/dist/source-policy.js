import { extname } from "node:path";
import { existsSync, statSync } from "node:fs";
import { check } from "./io.js";
import { SOURCE_KINDS } from "./rules.js";
const hostRecovery = "需要识别、转换或提取内容的资料由宿主实际可用的工具处理。将真实结果通过 source_import 的 hostResult 保存；没有可用工具时，请创作者提供可读取的文本。不得自动安装转换程序或把未处理的材料标为已读。";
export const sourcePolicy = {
    version: 4,
    supportedKinds: SOURCE_KINDS,
    hostProcessedKinds: ["webpage", "scan", "audio", "video"],
    hostRecovery,
    // Compatibility for integrations that read the previous audio/video policy.
    mediaRecovery: hostRecovery,
    legacyReadOnlyKinds: ["xiaohongshu"],
    recovery: "此版本不再采集小红书账号。可提供本地文件或粘贴原文；根据创作者选择调整来源计划，保留历史材料和确认记录。",
};
const textExtensions = new Set([
    ".md", ".markdown", ".txt", ".json", ".jsonl", ".csv", ".tsv",
    ".yaml", ".yml", ".xml", ".mm", ".opml",
]);
const skillTextExtensions = new Set([
    ...textExtensions, ".py", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".sh", ".css",
]);
/** Pure text is archived verbatim; this does not extract structure from XML or mind maps. */
export function isTextSourcePath(uri, kind = "file") {
    const extension = extname(uri).toLowerCase();
    return (kind === "skill" ? skillTextExtensions : textExtensions).has(extension);
}
/** Kept for clients that distinguish audio/video presentation from other source kinds. */
export function isHostMedia(kind) {
    return kind === "audio" || kind === "video";
}
export function sourceRequiresHostResult(source) {
    if (source.kind === "oral" || source.kind === "xiaohongshu")
        return false;
    if (sourcePolicy.hostProcessedKinds.includes(source.kind))
        return true;
    // A selected Skill directory is a text archive. Files with binary formats still need a host result.
    if (source.kind === "skill" && source.uri && existsSync(source.uri) && statSync(source.uri).isDirectory())
        return false;
    if (source.kind === "skill" && !extname(source.uri ?? ""))
        return false;
    return !isTextSourcePath(source.uri ?? "", source.kind);
}
export function sourceNeedsHostResult(source) {
    if (source.status === "ready")
        return false;
    if (source.extraction)
        return source.extraction.coverage !== "complete";
    const code = source.errorDetails?.code;
    return code === "HOST_SOURCE_REQUIRED" || sourceRequiresHostResult(source);
}
export function assertSourceSupported(kind) {
    check(SOURCE_KINDS.includes(kind), "SOURCE_UNSUPPORTED", kind === "xiaohongshu" ? sourcePolicy.recovery : "此版本不支持该来源类型。", { kind });
}
export function assertWebSourceSupported(uri) {
    let url;
    try {
        url = new URL(uri);
    }
    catch {
        check(false, "URL_PROTOCOL", "网页来源需要有效的 HTTP(S) 网址。");
    }
    check(["http:", "https:"].includes(url.protocol), "URL_PROTOCOL", "网页来源仅支持 HTTP(S)。");
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    check(!["xiaohongshu.com", "xhslink.com"].some((domain) => hostname === domain || hostname.endsWith(`.${domain}`)), "SOURCE_UNSUPPORTED", sourcePolicy.recovery);
}
/** Read-only projection: never rewrite archived manifests or source-plan decisions on upgrade. */
export function sourceView(source) {
    if (sourceNeedsHostResult(source))
        return {
            ...source, status: "failed",
            error: source.extraction?.coverage === "partial" ? "宿主仅提供了部分资料结果，已保留，但尚未完整处理。" : sourcePolicy.hostRecovery,
            errorDetails: { code: source.extraction?.coverage === "partial" ? "HOST_SOURCE_INCOMPLETE" : "HOST_SOURCE_REQUIRED", originalStatus: source.status },
            warnings: [...source.warnings, "请使用宿主工具补齐结果，以新的 operationId 导入；旧资料与确认记录保留。"],
        };
    if (source.kind !== "xiaohongshu" || source.status === "ready")
        return source;
    return { ...source, status: "failed", error: sourcePolicy.recovery,
        errorDetails: { code: "SOURCE_UNSUPPORTED", originalStatus: source.status },
        warnings: [...source.warnings, "该历史采集任务已停止自动恢复。"] };
}
