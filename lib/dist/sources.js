import { spawn } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readdirSync, statSync, } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { zipSync } from "fflate";
import { atomic, BuddyError, check, hash, immutable, json, jsonFiles, now, optional, read, safeId, withLock, } from "./io.js";
import { assertSourceSupported, assertWebSourceSupported, isTextSourcePath, sourceRequiresHostResult, sourceNeedsHostResult, sourcePolicy, sourceView } from "./source-policy.js";
function validateHostSourceResult(request) {
    const result = request.hostResult;
    check(request.kind !== "oral", "HOST_RESULT_KIND", "口述来源直接保存创作者原话，不接受 hostResult。");
    check(result, "HOST_SOURCE_REQUIRED", sourcePolicy.hostRecovery, {
        kind: request.kind,
        required: "hostResult: {tool, coverage, parts: [{text, locator}], notes?}",
    });
    check(typeof request.uri === "string" && request.uri.trim(), "SOURCE_LOCATION", "请同时提供创作者选定的本地原件路径或网页网址，供结果关联与归档。");
    if (request.kind === "webpage")
        assertWebSourceSupported(request.uri);
    check(typeof result.tool === "string" && result.tool.trim() &&
        ["complete", "partial"].includes(result.coverage), "HOST_SOURCE_RESULT", "请如实记录实际使用的宿主工具及 complete / partial 处理范围。");
    check(Array.isArray(result.parts) && result.parts.length && result.parts.every((part) => part && typeof part.text === "string" && part.text.trim() &&
        typeof part.locator === "string" && part.locator.trim()), "HOST_SOURCE_RESULT", "宿主结果需包含实际取得的文字和位置。页码、时间戳或节点不可得时使用段落位置并注明 unavailable，不虚构定位。");
    check(result.notes === undefined || (Array.isArray(result.notes) && result.notes.every((note) => typeof note === "string")), "HOST_SOURCE_RESULT", "处理范围与限制应以 notes 文字列表保存。");
    return result;
}
export function run(program, args, timeout = 120000) {
    return new Promise((resolve, reject) => {
        const child = spawn(program, args, { stdio: ["ignore", "pipe", "pipe"] });
        let out = "", err = "";
        const timer = setTimeout(() => {
            child.kill("SIGTERM");
            reject(new BuddyError("TOOL_TIMEOUT", "资料工具运行超时，已保留来源，可重试当前步骤。"));
        }, timeout);
        child.stdout.on("data", (chunk) => {
            out += chunk.toString();
            if (Buffer.byteLength(out) > 64000000) {
                child.kill();
                reject(new BuddyError("TOOL_OUTPUT_LIMIT", "工具输出过大，请拆分这份资料。"));
            }
        });
        child.stderr.on("data", (chunk) => {
            err = (err + chunk.toString()).slice(-12000);
        });
        child.on("error", (e) => {
            clearTimeout(timer);
            reject(new BuddyError("TOOL_UNAVAILABLE", `无法运行 ${program}。`, {
                error: e.message,
            }));
        });
        child.on("close", (code) => {
            clearTimeout(timer);
            code === 0
                ? resolve(out)
                : reject(new BuddyError("SOURCE_TOOL_FAILED", `${program} 处理失败。`, {
                    exitCode: code,
                    error: err,
                }));
        });
    });
}
export function chunkParts(parts) {
    const chunks = [];
    for (const p of parts) {
        for (let start = 0; start < p.text.length; start += 4000) {
            const text = p.text.slice(start, start + 4000);
            if (!text.trim())
                continue;
            const locator = `${p.locator};chars=${start}-${start + text.length}`;
            chunks.push({
                id: `chunk_${hash({ locator, text }).slice(0, 24)}`,
                text,
                locator,
                hash: hash(text),
            });
        }
    }
    return chunks;
}
function visibleText(value) {
    if (typeof value === "string")
        return value;
    if (Array.isArray(value))
        return value
            .map((v) => typeof v === "string"
            ? v
            : v &&
                typeof v === "object" &&
                ["text", "input_text", "output_text"].includes(v.type)
                ? String(v.text ?? "")
                : "")
            .filter(Boolean)
            .join("\n");
    return "";
}
export function parseHistory(text) {
    let records;
    try {
        const v = JSON.parse(text);
        records = Array.isArray(v) ? v : (v.messages ?? v.turns ?? [v]);
    }
    catch {
        records = text
            .split(/\r?\n/)
            .filter(Boolean)
            .map((line) => JSON.parse(line));
    }
    const parts = [];
    for (let i = 0; i < records.length; i++) {
        const r = records[i];
        if (r.isMeta || r.isSidechain)
            continue;
        let role, content = "";
        if (r.type === "event_msg" &&
            ["user_message", "agent_message"].includes(r.payload?.type)) {
            role = r.payload.type === "user_message" ? "user" : "assistant";
            content = visibleText(r.payload.message);
        }
        else {
            const m = r.message ?? r;
            role =
                m.role ?? (["user", "assistant"].includes(r.type) ? r.type : undefined);
            content = visibleText(m.content ?? m.text);
        }
        if (!["user", "assistant"].includes(role ?? "") || !content.trim())
            continue;
        content = content
            .replace(/<(environment_context|permissions|recommended_plugins|in-app-browser-context)>[\s\S]*?<\/\1>/g, "")
            .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, "[已移除密钥]")
            .replace(/(Bearer\s+)[A-Za-z0-9._-]{16,}/gi, "$1[已移除]");
        if (content.trim())
            parts.push({
                text: `${role}: ${content.trim()}`,
                locator: `message=${i + 1};role=${role}`,
            });
    }
    check(parts.length, "HISTORY_EMPTY", "这份文件中没有支持的可见用户或助手消息。");
    return parts;
}
function utf8Text(data) {
    try {
        const text = new TextDecoder("utf-8", { fatal: true }).decode(data);
        check(!text.includes("\0"), "HOST_SOURCE_REQUIRED", sourcePolicy.hostRecovery);
        return text;
    }
    catch (error) {
        if (error instanceof BuddyError)
            throw error;
        throw new BuddyError("HOST_SOURCE_REQUIRED", "这份材料不是可直接归档的 UTF-8 文本。请由宿主工具转换后提供 hostResult。", {
            recovery: sourcePolicy.hostRecovery,
        });
    }
}
async function parseLocal(_store, path, request) {
    check(existsSync(path), "FILE_MISSING", "找不到选定的来源文件。", { path });
    const result = request.hostResult ? validateHostSourceResult(request) : undefined;
    const extras = result ? [{ name: "host-result.json", data: Buffer.from(JSON.stringify(result, null, 2)) }] : [];
    const warnings = result ? [
        "资料文字来自宿主实际提供的工具结果；仅在所记录的位置与覆盖范围内引用，归纳仍需创作者校准。",
        ...(result.notes ?? []),
    ] : [];
    if (request.kind === "skill" && statSync(path).isDirectory()) {
        const files = {};
        const textParts = [];
        let totalBytes = 0;
        function visit(directory) {
            for (const name of readdirSync(directory).sort()) {
                const file = join(directory, name);
                if (lstatSync(file).isSymbolicLink())
                    continue;
                const stat = statSync(file);
                if (stat.isDirectory()) {
                    if (![".git", "node_modules"].includes(name))
                        visit(file);
                }
                else if (stat.isFile()) {
                    const rel = relative(path, file).split("\\").join("/");
                    if (!isTextSourcePath(rel, "skill"))
                        continue;
                    check(Object.keys(files).length < 5000, "SOURCE_SIZE", "Skill 文本文件数超过5000，请限定来源范围。");
                    totalBytes += stat.size;
                    check(totalBytes <= 512 * 1024 * 1024, "SOURCE_SIZE", "Skill 文本目录超过512MB，请限定来源范围。");
                    const data = readFileSync(file);
                    const text = utf8Text(data);
                    files[rel] = data;
                    textParts.push({ text, locator: `file=${rel}` });
                }
            }
        }
        visit(path);
        const parts = result?.parts ?? textParts;
        check(parts.some((part) => part.text.trim()), "SKILL_EMPTY", "所选 Skill 目录中没有可整理的文本。");
        warnings.push("所选 Skill 目录只归档文本文件；跳过链接、依赖目录和非文本附件，不执行其中的脚本。非文本附件需单独选择并由宿主处理。");
        return { parts, original: Buffer.from(zipSync(files)), name: `${basename(path)}-texts.zip`,
            parser: result ? "host-skill-text-result-v1" : "skill-text-archive-v2", warnings, extras };
    }
    check(statSync(path).isFile(), "SOURCE_NOT_FILE", "请提供具体文件，或使用 Skill 类型导入目录。");
    check(statSync(path).size <= 512 * 1024 * 1024, "SOURCE_SIZE", "单个来源暂支持512MB以内；请按章节或媒体片段拆分。");
    const original = readFileSync(path);
    let parts;
    let parser;
    if (result) {
        parts = result.parts;
        parser = request.kind === "history" ? "host-selected-visible-messages-v1" : "host-source-result-v1";
    }
    else if (request.kind === "history") {
        parts = parseHistory(utf8Text(original));
        parser = "selected-visible-messages-v1";
    }
    else {
        check(!sourceRequiresHostResult(request), "HOST_SOURCE_REQUIRED", sourcePolicy.hostRecovery);
        parts = [{ text: utf8Text(original), locator: "document" }];
        parser = "text-verbatim-v2";
    }
    if (request.kind === "history")
        warnings.push("原始会话文件仅保留在本机私有归档；资料产物只包含选定的可见用户和助手消息，宿主结果也必须限定在这一范围，不包含工具调用和宿主上下文。");
    check(parts.some((part) => part.text.trim()), "EMPTY_SOURCE", "没有取得可用内容，不能标为已读取。");
    return { parts, original, name: basename(path), parser, warnings, extras };
}
/** Compatibility entry point: webpage extraction now belongs to the host, with no implicit fetch. */
export async function readableWeb(url) {
    assertWebSourceSupported(url);
    throw new BuddyError("HOST_SOURCE_REQUIRED", sourcePolicy.hostRecovery, { kind: "webpage", uri: url });
}
export function enqueueSource(store, request) {
    assertSourceSupported(request.kind);
    if (request.kind === "webpage")
        assertWebSourceSupported(request.uri ?? "");
    if (request.hostResult || sourceRequiresHostResult(request))
        validateHostSourceResult(request);
    if (request.kind === "oral")
        check(typeof request.text === "string" && request.text.trim(), "SOURCE_LOCATION", "口述来源需要保存创作者的完整原话。");
    else
        check(typeof request.uri === "string" && request.uri.trim(), "SOURCE_LOCATION", "非口述来源需要选定原件路径或网页网址。");
    safeId(request.operationId);
    check(request.uri || request.text?.trim(), "SOURCE_LOCATION", "请提供来源路径、网址或口述原文。");
    const path = store.path("source-jobs", "requests", `${request.operationId}.json`), previous = optional(path);
    if (previous) {
        check(previous.digest === hash(request), "IDEMPOTENCY_CONFLICT", "同一来源操作身份不能更换内容。");
        return store.source(previous.sourceId);
    }
    const sourceId = `source_${hash(request.operationId).slice(0, 24)}`, jobId = `job_${hash(request.operationId).slice(0, 24)}`;
    const manifest = {
        id: sourceId,
        version: "queued",
        kind: request.kind,
        title: request.title ?? basename(request.uri ?? "创作者口述"),
        uri: request.uri ?? "oral:",
        status: "queued",
        files: [],
        chunks: [],
        acquiredAt: now(),
        jobId,
        attempt: 0,
        warnings: [],
        parser: "",
        ...(request.hostResult ? { extraction: {
                provider: "host",
                tool: request.hostResult.tool,
                coverage: request.hostResult.coverage,
                notes: request.hostResult.notes,
            } } : {}),
        processing: {
            acquisition: "queued",
            parsing: "not_started",
            semanticReview: "requires_host_calibration",
        },
    };
    immutable(store.path("source-jobs", `${jobId}.json`), request);
    immutable(store.path("sources", sourceId, "versions", "queued.json"), manifest);
    json(store.path("sources", sourceId, "HEAD.json"), { version: "queued" });
    immutable(path, { digest: hash(request), sourceId });
    return manifest;
}
export async function processSource(store, sourceId) {
    return withLock(store.path("source-jobs", "locks", safeId(sourceId)), async () => {
        const previous = store.source(sourceId);
        if (previous.status === "ready")
            return previous;
        assertSourceSupported(previous.kind);
        const completed = jsonFiles(store.path("sources", sourceId, "versions")).find((v) => v.status === "ready" && v.jobId === previous.jobId);
        if (completed) {
            check(completed.files.every((f) => existsSync(store.path(f.path)) &&
                hash(readFileSync(store.path(f.path))) === f.hash), "SOURCE_ASSET_CHANGED", "已完成来源的文件被改动，已停止恢复。");
            json(store.path("sources", sourceId, "HEAD.json"), {
                version: completed.version,
            });
            return completed;
        }
        const request = read(store.path("source-jobs", `${previous.jobId}.json`));
        assertSourceSupported(request.kind);
        // Removed converters must not restart legacy jobs or rewrite their archived states.
        if (!request.hostResult && (sourceRequiresHostResult(request) || sourceNeedsHostResult(previous)))
            return sourceView(previous);
        if (previous.status === "failed" && sourceNeedsHostResult(previous) && previous.files.length)
            return sourceView(previous);
        const manifest = {
            ...previous,
            version: `attempt_${previous.attempt + 1}`,
            attempt: previous.attempt + 1,
            status: "running",
            error: undefined,
            processing: {
                acquisition: "running",
                parsing: "not_started",
                semanticReview: "requires_host_calibration",
            },
        };
        immutable(store.path("sources", sourceId, "versions", `${manifest.version}.json`), manifest);
        json(store.path("sources", sourceId, "HEAD.json"), {
            version: manifest.version,
        });
        const save = (name, data) => {
            const bytes = typeof data === "string" ? Buffer.from(data) : data, digest = hash(bytes), path = `sources/blobs/${digest}/${name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
            if (!existsSync(store.path(path)))
                atomic(store.path(path), bytes);
            manifest.files.push({ path, hash: digest, bytes: bytes.length });
            return path;
        };
        try {
            let parts = [];
            manifest.files = [];
            manifest.warnings = [];
            if (request.hostResult) {
                const result = validateHostSourceResult(request);
                manifest.extraction = { provider: "host", tool: result.tool, coverage: result.coverage, notes: result.notes };
            }
            if (request.kind === "oral") {
                parts = [{ text: request.text, locator: "creator-oral" }];
                save("oral.txt", request.text);
                manifest.parser = "oral-verbatim-v1";
                manifest.processing.acquisition = "complete";
                manifest.processing.parsing = "running";
            }
            else if (request.kind === "webpage") {
                const result = validateHostSourceResult(request);
                parts = result.parts;
                save("host-result.json", JSON.stringify(result, null, 2));
                save("webpage-snapshot.json", JSON.stringify({
                    archiveKind: "host-extracted-snapshot",
                    url: request.uri,
                    capturedAt: manifest.acquiredAt,
                    notice: "宿主读取结果的归档快照，不是网站原始 HTML 或完整网页副本。",
                    hostResult: result,
                }, null, 2));
                manifest.title = request.title ?? new URL(request.uri).hostname;
                manifest.parser = "host-webpage-snapshot-v1";
                manifest.warnings = ["仅归档宿主实际取得的网页文字与位置；不表示已保存原始 HTML、登录后内容或所有链接页面。", ...(result.notes ?? [])];
                manifest.processing.acquisition = "complete";
                manifest.processing.parsing = "running";
            }
            else {
                const requestedPath = resolve(request.uri);
                const acquiredPath = store.path("source-jobs", "acquired", `${previous.jobId}.json`);
                let acquired = optional(acquiredPath);
                if (!acquired &&
                    existsSync(requestedPath) &&
                    statSync(requestedPath).isFile()) {
                    check(statSync(requestedPath).size <= 512 * 1024 * 1024, "SOURCE_SIZE", "单个来源暂支持512MB以内。");
                    const data = readFileSync(requestedPath), name = basename(requestedPath);
                    const path = request.kind === "history"
                        ? store.path(".private-sources", `${hash(data)}-${name}`)
                        : store.path(save(`original-${name}`, data));
                    if (request.kind === "history")
                        atomic(path, data);
                    acquired = { path, name, sha256: hash(data) };
                    immutable(acquiredPath, acquired);
                }
                if (acquired) {
                    const expected = acquired.sha256 ?? /([a-f0-9]{64})/.exec(acquired.path)?.[1];
                    check(expected && hash(readFileSync(acquired.path)) === expected, "SOURCE_ASSET_CHANGED", "已归档原件发生改变，不能在新版本中默默接纳改动。");
                }
                if (acquired && request.kind !== "history") {
                    const data = readFileSync(acquired.path);
                    const rel = relative(store.directory, acquired.path);
                    if (!manifest.files.some((f) => f.path === rel))
                        manifest.files.push({
                            path: rel,
                            hash: hash(data),
                            bytes: data.length,
                        });
                }
                if (acquired)
                    manifest.processing.acquisition = "complete";
                manifest.processing.parsing = "running";
                const result = await parseLocal(store, acquired?.path ?? requestedPath, request);
                parts = result.parts;
                if (request.kind === "history")
                    save("original-visible-messages.json", JSON.stringify(parts, null, 2));
                else if (!acquired)
                    save(`original-${result.name}`, result.original);
                manifest.parser = result.parser;
                manifest.processing.acquisition = "complete";
                manifest.warnings = result.warnings;
                for (const extra of result.extras ?? [])
                    save(extra.name, extra.data);
            }
            manifest.chunks = chunkParts(parts);
            check(manifest.chunks.length, "EMPTY_SOURCE", "没有取得可引用的完整文本。");
            save("fulltext.txt", parts.map((p) => `[${p.locator}]\n${p.text}`).join("\n\n"));
            save("chunks.json", JSON.stringify(manifest.chunks, null, 2));
            check(!request.hostResult || request.hostResult.coverage === "complete", "HOST_SOURCE_INCOMPLETE", "宿主仅提供了部分资料结果，已保存原件或网页快照及处理结果，但尚未完整处理。请补齐后以新的 operationId 导入，不重复重试相同的部分结果。", { recovery: sourcePolicy.hostRecovery });
            manifest.status = "ready";
            manifest.processing.parsing = "complete";
            manifest.version = `sourcev_${hash({ files: manifest.files, parser: manifest.parser }).slice(0, 28)}`;
        }
        catch (error) {
            manifest.status = "failed";
            if (manifest.processing.acquisition === "running")
                manifest.processing.acquisition = manifest.files.length
                    ? "partial"
                    : "failed";
            if (manifest.processing.parsing === "running")
                manifest.processing.parsing = manifest.chunks.length
                    ? "partial"
                    : "failed";
            manifest.version = `failed_${manifest.attempt}`;
            manifest.error =
                error instanceof BuddyError
                    ? error.message
                    : "资料未能完整读取，已保留进度。请在主对话中检查文件格式或当前访问权限后重试。";
            manifest.errorDetails =
                error instanceof BuddyError
                    ? { code: error.code, details: error.details }
                    : {
                        message: error instanceof Error ? error.message : String(error),
                    };
        }
        immutable(store.path("sources", sourceId, "versions", `${manifest.version}.json`), manifest);
        json(store.path("sources", sourceId, "HEAD.json"), {
            version: manifest.version,
        });
        return manifest;
    });
}
