import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { extname, join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { createConnection } from "node:net";
import { check, BuddyError, hash, immutable, json, jsonFiles, optional, read, safeId, withLock, } from "./io.js";
import { projectPreview } from "./preview-model.js";
import { previewActivity } from "./preview-activity.js";
import { completionSnapshot } from "./completion.js";
import { sourceView } from "./source-policy.js";
function acceptedSteps(store) {
    return new Set(jsonFiles(store.path("runtime-work", "operations")).map((o) => read(store.path("runtime-work", "results", `${safeId(o.resultRef)}.json`)).stepId));
}
export function publishDraft(store, sessionId, args) {
    const session = store.requireSession(sessionId), item = read(store.path("runtime-work", "items", `${safeId(args.stepId)}.json`));
    check(item.operationEpoch === session.epoch &&
        item.requestId === session.activeRequestId &&
        item.baseRevision === store.load().revision &&
        args.contextDigest === item.contextDigest, "STALE_DRAFT", "这份草稿的工作项已失效。");
    check(!session.paused && !acceptedSteps(store).has(item.stepId), "STALE_DRAFT", "这项工作已提交结果或已暂停，不能继续发布草稿。");
    check(Number.isInteger(args.sequence) &&
        args.sequence >= 0 &&
        args.markdown.length <= 64000, "DRAFT_BUDGET", "草稿序号无效或单个可见块超过64,000字符。");
    const draft = {
        id: `draft_${hash({ stepId: args.stepId, sequence: args.sequence }).slice(0, 24)}`,
        stepId: args.stepId,
        requestId: item.requestId,
        epoch: session.epoch,
        baseRevision: item.baseRevision,
        sequence: args.sequence,
        markdown: args.markdown,
        title: args.title,
        hash: hash(args.markdown),
    };
    immutable(store.path("drafts", `${draft.id}.json`), draft);
    return draft;
}
export function previewSnapshot(store) {
    const state = store.load(), session = store.session();
    const accepted = acceptedSteps(store);
    const delivery = state.currentDeliveryId ? store.delivery(state.currentDeliveryId) : undefined;
    const projection = projectPreview(state, delivery);
    const sources = store.sourceList().map(sourceView);
    const drafts = jsonFiles(store.path("drafts"))
        .filter((d) => d.requestId === session?.activeRequestId &&
        d.epoch === session.epoch &&
        d.baseRevision === state.revision &&
        !accepted.has(d.stepId))
        .sort((a, b) => a.sequence - b.sequence);
    return {
        buddyId: state.buddyId,
        revision: state.revision,
        stage: state.stage,
        paused: state.paused,
        activity: previewActivity(store, state, session, accepted, drafts, sources),
        completion: completionSnapshot(store),
        current: projection.current,
        stages: projection.stages,
        artifacts: projection.artifacts.map((a) => ({
            ...a,
            evidence: a.evidence.map((r) => ({
                type: r.type,
                id: r.id,
                hash: r.hash,
                locator: r.locator,
                quote: r.quote,
            })),
            dependencies: undefined,
        })),
        sources: sources
            .map((s) => ({
            id: s.id,
            title: s.title,
            kind: s.kind,
            status: s.status,
            error: s.error,
            version: s.version,
            warnings: s.warnings,
        })),
        drafts: drafts.length ? [drafts.at(-1)] : [],
        continuation: sources
            .some((s) => s.status === "ready" && state.sources[s.id]?.version !== s.version)
            ? "资料已就绪，回到主对话说“继续”。"
            : undefined,
    };
}
const runtimeVersion = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
const validPort = (value) => Number.isInteger(value) && Number(value) > 0 && Number(value) <= 65535;
const validToken = (value) => typeof value === "string" && /^[a-f0-9]{48}$/.test(value);
function serverRecord(store) {
    const info = optional(store.path("preview-server.json"));
    if (!info)
        return;
    check(Number.isSafeInteger(info.pid) && info.pid > 0 && validToken(info.token), "PREVIEW_ADDRESS_INVALID", "预览进程记录无效，请检查当前搭子的 preview-server.json；不会自动换地址。");
    const match = typeof info.url === "string" && /^http:\/\/127\.0\.0\.1:(\d+)\/p\/([a-f0-9]{48})\/$/.exec(info.url);
    check(match && validPort(Number(match[1])) && match[2] === info.token &&
        (!info.workspaceId || info.workspaceId === store.load().workspaceId), "PREVIEW_ADDRESS_INVALID", "预览地址不属于当前搭子的本机服务，已保留记录，不会访问该地址。");
    return info;
}
function savedEndpoint(store) {
    const workspaceId = store.load().workspaceId;
    const endpoint = optional(store.path("preview-endpoint.json"));
    if (endpoint) {
        check(endpoint.version === 1 && endpoint.workspaceId === workspaceId && validPort(endpoint.port) && validToken(endpoint.token), "PREVIEW_ADDRESS_INVALID", "固定预览地址无效或属于其他搭子，请检查 preview-endpoint.json；不会覆盖原记录。");
        return endpoint;
    }
    // Adopt the most recently used URL on upgrade, including its secret path.
    const legacy = serverRecord(store);
    return legacy ? { version: 1, workspaceId, port: Number(new URL(legacy.url).port), token: legacy.token } : undefined;
}
async function previewAlive(store, info) {
    try {
        const health = await fetch(`${info.url}api/health`, { signal: AbortSignal.timeout(1500), redirect: "error" });
        if (health.ok) {
            const identity = await health.json();
            check(identity.workspaceId === store.load().workspaceId && identity.pid === info.pid, "PREVIEW_IDENTITY_MISMATCH", "这个端口上的服务不是所记录的当前搭子预览，未接管或停止它。");
            return true;
        }
        // Pre-0.1.15 servers do not expose the health endpoint.
        if (health.status === 404 && !info.workspaceId) {
            const response = await fetch(`${info.url}api/snapshot`, { signal: AbortSignal.timeout(1500), redirect: "error" });
            if (response.ok) {
                const view = await response.json();
                check(view.buddyId === store.load().buddyId, "PREVIEW_IDENTITY_MISMATCH", "端口上的预览不属于当前搭子，未接管或停止它。");
                return true;
            }
        }
        return false;
    }
    catch (error) {
        if (error instanceof BuddyError)
            throw error;
        return false;
    }
}
function portListening(port) {
    return new Promise((resolve) => {
        const socket = createConnection({ host: "127.0.0.1", port });
        const done = (listening) => { socket.destroy(); resolve(listening); };
        socket.once("connect", () => done(true));
        socket.once("error", () => done(false));
        socket.setTimeout(250, () => done(true));
    });
}
export async function servePreview(store, port = 0) {
    return withLock(store.path(".preview-binding"), async () => {
        check(port === 0 || validPort(port), "PREVIEW_PORT_INVALID", "预览端口须为 1—65535；省略端口会复用当前搭子的固定地址。");
        const endpoint = savedEndpoint(store);
        const desiredPort = port || endpoint?.port || 0;
        const token = endpoint?.token ?? randomBytes(24).toString("hex"), base = `/p/${token}/`;
        const workspaceId = store.load().workspaceId;
        const standardRoot = fileURLToPath(new URL("../preview-dist/", import.meta.url));
        const staticRoot = existsSync(join(standardRoot, "index.html")) ? standardRoot
            : fileURLToPath(new URL("../../assets/preview/", import.meta.url));
        check(existsSync(join(staticRoot, "index.html")), "PREVIEW_NOT_BUILT", "预览尚未构建，请先运行安装包的构建步骤。");
        const clients = new Set();
        const server = createServer((req, res) => {
            const address = server.address();
            const host = typeof address === "object" && address ? `127.0.0.1:${address.port}` : "";
            res.setHeader("X-Content-Type-Options", "nosniff");
            res.setHeader("Referrer-Policy", "no-referrer");
            res.setHeader("Cache-Control", "no-store");
            res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'");
            if (req.method !== "GET") {
                res.writeHead(405);
                res.end("预览只读，请回到主对话修改。");
                return;
            }
            if (req.headers.host !== host ||
                (req.headers.origin && req.headers.origin !== `http://${host}`)) {
                res.writeHead(403);
                res.end();
                return;
            }
            const path = new URL(req.url ?? "/", `http://${host}`).pathname;
            if (!path.startsWith(base)) {
                res.writeHead(404);
                res.end();
                return;
            }
            const route = path.slice(base.length);
            try {
                if (route === "api/health") {
                    res.setHeader("Connection", "close");
                    res.setHeader("Content-Type", "application/json; charset=utf-8");
                    res.end(JSON.stringify({ workspaceId, pid: process.pid, runtimeVersion }));
                    return;
                }
                if (route === "api/snapshot") {
                    res.setHeader("Content-Type", "application/json; charset=utf-8");
                    res.end(JSON.stringify(previewSnapshot(store)));
                    return;
                }
                if (route === "api/events") {
                    res.writeHead(200, {
                        "Content-Type": "text/event-stream",
                        Connection: "keep-alive",
                    });
                    res.write("event: ready\ndata: {}\n\n");
                    clients.add(res);
                    req.on("close", () => clients.delete(res));
                    return;
                }
                const file = resolve(staticRoot, route || "index.html");
                if (!file.startsWith(resolve(staticRoot) + "/")) {
                    res.writeHead(404);
                    res.end();
                    return;
                }
                if (!existsSync(file)) {
                    res.writeHead(404);
                    res.end();
                    return;
                }
                const types = {
                    ".html": "text/html; charset=utf-8",
                    ".js": "text/javascript; charset=utf-8",
                    ".css": "text/css; charset=utf-8",
                    ".svg": "image/svg+xml",
                    ".woff2": "font/woff2",
                };
                res.setHeader("Content-Type", types[extname(file)] ?? "application/octet-stream");
                res.end(readFileSync(file));
            }
            catch {
                res.writeHead(503);
                res.end("内容暂时无法读取，保留页面并回到主对话检查。");
            }
        });
        try {
            await new Promise((resolve, reject) => {
                const failed = (error) => reject(error);
                server.once("error", failed);
                server.listen(desiredPort, "127.0.0.1", () => { server.removeListener("error", failed); resolve(); });
            });
        }
        catch (error) {
            if (error.code === "EADDRINUSE")
                throw new BuddyError("PREVIEW_PORT_IN_USE", `当前搭子的固定端口 ${desiredPort} 已被占用。已保留原地址，没有切换端口或停止其他程序；检查占用后重试。确需迁移时，显式使用 buddy serve --workspace <目录> --port <新端口>。`, { port: desiredPort, url: endpoint ? `http://127.0.0.1:${endpoint.port}/p/${endpoint.token}/` : undefined });
            throw error;
        }
        const address = server.address();
        check(address && typeof address === "object", "PREVIEW_ADDRESS", "未取得本地预览地址。");
        const url = `http://127.0.0.1:${address.port}${base}`;
        try {
            json(store.path("preview-endpoint.json"), { version: 1, workspaceId, port: address.port, token });
            json(store.path("preview-server.json"), { pid: process.pid, url, token, workspaceId, runtimeVersion });
        }
        catch (error) {
            server.close();
            throw error;
        }
        let previous = "", unavailable = false;
        const timer = setInterval(() => {
            try {
                const current = hash(previewSnapshot(store));
                if (current !== previous || unavailable) {
                    previous = current;
                    unavailable = false;
                    for (const client of clients)
                        client.write(`event: changed\ndata: ${JSON.stringify({ version: current })}\n\n`);
                }
                else
                    for (const client of clients)
                        client.write(": heartbeat\n\n");
            }
            catch {
                unavailable = true;
                for (const client of clients)
                    client.write("event: unavailable\ndata: {}\n\n");
            }
        }, 1000);
        server.on("close", () => clearInterval(timer));
        return { url, server };
    });
}
export async function startPreview(store, openBrowser = true) {
    return withLock(store.path(".preview-lifecycle"), async () => {
        savedEndpoint(store);
        let info = serverRecord(store);
        if (info && !await previewAlive(store, info))
            info = undefined;
        if (info && info.runtimeVersion !== runtimeVersion) {
            check(info.pid !== process.pid, "PREVIEW_RESTART_REQUIRED", "请从新的工具进程重新打开预览，以加载当前版本。");
            await stopVerifiedPreview(info);
            info = undefined;
        }
        if (!info) {
            const cli = fileURLToPath(new URL("./cli.js", import.meta.url));
            check(existsSync(cli), "BUILD_REQUIRED", "请先构建 CLI 后再打开预览。");
            const child = spawn(process.execPath, [cli, "serve", "--workspace", store.directory], { detached: true, stdio: ["ignore", "pipe", "pipe"] });
            let startupOutput = "", startupError;
            child.stdout?.on("data", (data) => { if (startupOutput.length < 16000)
                startupOutput += data.toString(); });
            child.stderr?.on("data", () => undefined);
            child.on("error", (error) => { startupError = error; });
            child.unref();
            try {
                for (let i = 0; i < 60; i++) {
                    await new Promise((r) => setTimeout(r, 100));
                    if (startupError)
                        throw startupError;
                    if (child.exitCode !== null) {
                        let failure = {};
                        try {
                            failure = JSON.parse(startupOutput);
                        }
                        catch { }
                        throw new BuddyError(failure.error?.code ?? "PREVIEW_START_FAILED", failure.error?.message ?? "本地预览进程未能启动，请运行 buddy serve 查看具体错误。", failure.error?.details);
                    }
                    const next = serverRecord(store);
                    if (next && next.pid === child.pid) {
                        info = next;
                        break;
                    }
                }
                check(info, "PREVIEW_START_FAILED", "本地预览未能启动；请运行 buddy serve 查看具体错误。");
            }
            finally {
                if (!info && child.exitCode === null)
                    child.kill("SIGTERM");
                child.stdout?.destroy();
                child.stderr?.destroy();
            }
        }
        if (openBrowser && process.platform === "darwin") {
            const child = spawn("/usr/bin/open", [info.url], { stdio: "ignore" });
            child.on("error", () => undefined);
            child.unref();
        }
        return {
            url: info.url,
            displayStatus: openBrowser ? "browser_open_requested" : "not_opened",
            readonly: true,
            addressPolicy: "stable_per_workspace",
        };
    });
}
export async function stopPreview(store) {
    return withLock(store.path(".preview-lifecycle"), async () => {
        savedEndpoint(store);
        const info = serverRecord(store);
        if (!info)
            return { stopped: true, status: "not_running" };
        if (!await previewAlive(store, info)) {
            const occupied = await portListening(Number(new URL(info.url).port));
            return { stopped: !occupied, status: occupied ? "unverified_service_not_stopped" : "not_running", url: info.url };
        }
        return stopVerifiedPreview(info);
    });
}
async function stopVerifiedPreview(info) {
    process.kill(info.pid, "SIGTERM");
    for (let i = 0; i < 40; i++) {
        if (!await portListening(Number(new URL(info.url).port)))
            return { stopped: true, status: "stopped", url: info.url, addressPreserved: true };
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new BuddyError("PREVIEW_STOP_TIMEOUT", "预览仍在关闭，固定地址已保留；稍后重试，不要更换端口。", { url: info.url });
}
