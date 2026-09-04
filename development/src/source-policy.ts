import { check } from "./io.js";
import { SOURCE_KINDS } from "./rules.js";
import type { SourceManifest } from "./types.js";

export const sourcePolicy = {
  version: 2,
  supportedKinds: SOURCE_KINDS,
  legacyReadOnlyKinds: ["xiaohongshu"],
  recovery: "此版本不再采集小红书账号。可提供本地文件或粘贴原文；根据创作者选择调整来源计划，保留历史材料和确认记录。",
};

export function assertSourceSupported(kind: string) {
  check((SOURCE_KINDS as readonly string[]).includes(kind), "SOURCE_UNSUPPORTED",
    kind === "xiaohongshu" ? sourcePolicy.recovery : "此版本不支持该来源类型。", { kind });
}

export function assertWebSourceSupported(uri: string) {
  const url = new URL(uri);
  check(["http:", "https:"].includes(url.protocol), "URL_PROTOCOL", "网页来源仅支持 HTTP(S)。");
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  check(!["xiaohongshu.com", "xhslink.com"].some((domain) => hostname === domain || hostname.endsWith(`.${domain}`)),
    "SOURCE_UNSUPPORTED", sourcePolicy.recovery);
}

/** Read-only projection: never rewrite archived manifests or source-plan decisions on upgrade. */
export function sourceView(source: SourceManifest): SourceManifest {
  if (source.kind !== "xiaohongshu" || source.status === "ready") return source;
  return { ...source, status: "failed", error: sourcePolicy.recovery,
    errorDetails: { code: "SOURCE_UNSUPPORTED", originalStatus: source.status },
    warnings: [...source.warnings, "该历史采集任务已停止自动恢复。"] };
}
