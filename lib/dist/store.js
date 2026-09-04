import { existsSync, mkdirSync, readdirSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { CARDS, STAGES } from "./rules.js";
import { check, hash, id, immutable, json, jsonFiles, now, optional, read, safeId, withLock, } from "./io.js";
export class Store {
    directory;
    constructor(directory) {
        this.directory = directory;
        this.directory = realpathSync(directory);
    }
    path(...parts) {
        return join(this.directory, ...parts);
    }
    load() {
        return this.revision(read(this.path("HEAD.json")).revision).state;
    }
    revision(revision) {
        const record = read(this.path("revisions", `${safeId(revision)}.json`));
        check(record.digest === hash(record.body), "WORKSPACE_TAMPERED", "项目文件与记录摘要不一致。已停止写入，请保留现场核对。", { revision });
        return record.body;
    }
    session() {
        return optional(this.path("session.json"));
    }
    requireSession(sessionId) {
        const s = this.session();
        check(s?.id === sessionId, "SESSION_REPLACED", "当前连接已经被接替，请重新打开项目。");
        return s;
    }
    connect(host, sessionId, takeover = false) {
        const existing = this.session();
        if (existing && sessionId === existing.id && !takeover)
            return existing;
        check(!existing || existing.host === host || takeover, "SESSION_OWNED", "项目正在由另一个宿主接续；使用明确的接替操作继续。", { host: existing?.host });
        if (existing && existing.host === host && !takeover)
            return existing;
        const s = {
            id: id("session"),
            host,
            epoch: (existing?.epoch ?? 0) + 1,
        };
        json(this.path("session.json"), s);
        return s;
    }
    dialogue() {
        return optional(this.path("dialogue.json")) ?? {};
    }
    reserve(sessionId, clientKey, replyToDeliveryId) {
        this.requireSession(sessionId);
        check(clientKey.length > 0 && clientKey.length <= 256, "INPUT_IDENTITY_REQUIRED", "先为这条消息提供可恢复的 clientKey。");
        const path = this.path("inputs", "tickets", `${hash({ sessionId, clientKey })}.json`);
        const previous = optional(path);
        if (previous) {
            check(replyToDeliveryId === undefined || previous.replyToDeliveryId === replyToDeliveryId, "IDEMPOTENCY_CONFLICT", "同一输入身份不能改为回复另一份内容。");
            immutable(this.path("inputs", "tokens", `${previous.token}.json`), previous);
            return previous;
        }
        const ordinal = (optional(this.path("inputs", "sequence.json"))?.ordinal ?? 0) + 1;
        json(this.path("inputs", "sequence.json"), { ordinal });
        const ticket = {
            token: id("ingress"),
            inputId: id("input"),
            sessionId,
            clientKey,
            ordinal,
            createdAt: now(),
            replyToDeliveryId: replyToDeliveryId ?? this.dialogue().questionDeliveryId ?? this.dialogue().activeDeliveryId,
        };
        immutable(path, ticket);
        immutable(this.path("inputs", "tokens", `${ticket.token}.json`), ticket);
        return ticket;
    }
    pendingInputs(sessionId) {
        this.requireSession(sessionId);
        const done = new Set(this.load().answeredInputs);
        let revision = this.load().revision;
        while (revision) {
            const record = this.revision(revision);
            if (record.delivery?.inputId)
                done.add(record.delivery.inputId);
            revision = record.parent;
        }
        for (const event of jsonFiles(this.path("deliveries", "events")))
            if (event.delivery.inputId)
                done.add(event.delivery.inputId);
        return jsonFiles(this.path("inputs", "tickets"))
            .filter((t) => t.sessionId === sessionId && !done.has(t.inputId))
            .sort((a, b) => a.ordinal - b.ordinal)
            .map((t) => ({
            ...t,
            input: optional(this.path("inputs", "records", `${t.inputId}.json`)),
        }));
    }
    inputHistory(sessionId, offset = 0, limit = 20) {
        this.requireSession(sessionId);
        check(Number.isInteger(offset) &&
            offset >= 0 &&
            Number.isInteger(limit) &&
            limit > 0 &&
            limit <= 50, "PAGE_ARGUMENT", "输入历史分页参数无效。");
        const tickets = jsonFiles(this.path("inputs", "tickets")).sort((a, b) => a.ordinal - b.ordinal);
        return {
            inputs: tickets
                .slice(offset, offset + limit)
                .map((t) => ({
                ...t,
                input: optional(this.path("inputs", "records", `${t.inputId}.json`)),
            })),
            nextOffset: offset + limit < tickets.length ? offset + limit : null,
            total: tickets.length,
        };
    }
    record(sessionId, token, raw, annotation) {
        this.requireSession(sessionId);
        const ticket = read(this.path("inputs", "tokens", `${safeId(token)}.json`));
        check(ticket.sessionId === sessionId, "INPUT_SESSION", "输入凭据不属于当前连接。");
        check(raw.trim() && raw.length <= 200000, "INPUT_SIZE", "单次输入须为非空文本，且不超过 200,000 字符；更长内容请作为资料导入。");
        const path = this.path("inputs", "records", `${ticket.inputId}.json`);
        const previous = optional(path);
        if (previous) {
            check(previous.raw === raw && hash(previous.annotation) === hash(annotation), "IDEMPOTENCY_CONFLICT", "同一输入凭据不能提交不同内容。");
            this.reconcileInput(ticket);
            return previous;
        }
        const input = {
            id: ticket.inputId,
            token,
            raw,
            hash: hash(raw),
            sessionId,
            createdAt: ticket.createdAt,
            replyToDeliveryId: ticket.replyToDeliveryId,
            annotation,
        };
        immutable(path, input);
        this.reconcileInput(ticket);
        return input;
    }
    reconcileInput(ticket) {
        const dialogue = this.dialogue();
        const latest = dialogue.latestInputId ? this.input(dialogue.latestInputId) : undefined;
        const latestTicket = latest
            ? read(this.path("inputs", "tokens", `${latest.token}.json`))
            : undefined;
        if (!latestTicket || (latestTicket.ordinal ?? 0) < ticket.ordinal)
            json(this.path("dialogue.json"), {
                ...dialogue,
                latestInputId: ticket.inputId,
            });
    }
    input(inputId) {
        const input = read(this.path("inputs", "records", `${safeId(inputId)}.json`));
        check(input.id === inputId && input.hash === hash(input.raw), "INPUT_CHANGED", "原始输入记录被改动，请保留现场核对。");
        return input;
    }
    source(sourceId, version) {
        const selected = version ??
            read(this.path("sources", safeId(sourceId), "HEAD.json")).version;
        const manifest = read(this.path("sources", safeId(sourceId), "versions", `${safeId(selected)}.json`));
        check(manifest.id === sourceId && manifest.version === selected, "SOURCE_IDENTITY", "来源版本不匹配。");
        if (manifest.status === "ready") {
            const expected = `sourcev_${hash({ files: manifest.files, parser: manifest.parser }).slice(0, 28)}`;
            const chunkFile = manifest.files.find((f) => f.path.endsWith("/chunks.json"));
            check(selected === expected &&
                chunkFile?.hash === hash(JSON.stringify(manifest.chunks, null, 2)) &&
                manifest.chunks.every((c) => hash(c.text) === c.hash), "SOURCE_CHANGED", "来源清单或全文分块被改动，请保留现场核对。");
        }
        return manifest;
    }
    sourceList() {
        const path = this.path("sources");
        if (!existsSync(path))
            return [];
        return readdirSync(path)
            .filter((x) => existsSync(join(path, x, "HEAD.json")))
            .map((x) => this.source(x));
    }
    delivery(deliveryId) {
        return read(this.path("deliveries", "records", `${safeId(deliveryId)}.json`));
    }
    shown(deliveryId) {
        return Boolean(optional(this.path("deliveries", "presentation", `${safeId(deliveryId)}.json`)));
    }
    presentation(deliveryId, method) {
        const d = this.delivery(deliveryId);
        check(this.isDeliveryValid(d), "DELIVERY_SUPERSEDED", "这份回复已经被新输入或新版本替代。");
        const path = this.path("deliveries", "presentation", `${safeId(deliveryId)}.json`);
        const record = optional(path) ?? {
            deliveryId,
            method,
            at: now(),
            hash: d.hash,
        };
        immutable(path, record);
        return record;
    }
    isDeliveryValid(d) {
        const state = this.load(), dialogue = this.dialogue();
        if (existsSync(this.path("runtime-work", "cancelled", `${safeId(d.requestId)}.json`)))
            return false;
        if (dialogue.activeDeliveryId !== d.id)
            return false;
        if (dialogue.latestInputId && dialogue.latestInputId !== d.inputId)
            return false;
        if (d.kind === "content" && d.revision !== state.revision)
            return false;
        if (d.confirmationTarget?.objects.some((ref) => state.artifacts[ref.id]?.hash !== ref.hash))
            return false;
        if (d.question && state.targets[d.question.targetId]?.cycleId !== d.question.cycleId)
            return false;
        return true;
    }
    deliveryDirective(deliveryId) {
        if (!deliveryId)
            return { directive: "await_user" };
        const delivery = this.delivery(deliveryId);
        return this.isDeliveryValid(delivery)
            ? {
                directive: this.shown(deliveryId) ? "await_user" : "deliver",
                delivery,
            }
            : { directive: "await_user", supersededDeliveryId: deliveryId };
    }
    findReceipt(operationId) {
        let revision = this.load().revision;
        while (revision) {
            const r = this.revision(revision);
            if (r.receipt?.operationId === operationId)
                return r.receipt;
            revision = r.parent;
        }
        return optional(this.path("deliveries", "events", `${safeId(operationId)}.json`))?.receipt;
    }
    publishCommittedDelivery(d) {
        immutable(this.path("deliveries", "records", `${d.id}.json`), d);
        const dialogue = this.dialogue();
        // Reconciliation may rebuild an index, but must never revive an old response.
        if (dialogue.latestInputId && dialogue.latestInputId !== d.inputId)
            return;
        if (d.kind === "content" && this.load().revision !== d.revision)
            return;
        json(this.path("dialogue.json"), {
            ...dialogue,
            activeDeliveryId: d.id,
            questionDeliveryId: d.question || d.confirmationTarget
                ? d.id
                : d.kind === "explanation"
                    ? dialogue.questionDeliveryId
                    : undefined,
        });
    }
    reconcile() {
        const revision = this.revision(this.load().revision);
        if (revision.delivery &&
            !existsSync(this.path("deliveries", "records", `${revision.delivery.id}.json`)))
            this.publishCommittedDelivery(revision.delivery);
        else if (revision.delivery &&
            this.dialogue().activeDeliveryId !== revision.delivery.id &&
            this.dialogue().latestInputId === revision.delivery.inputId)
            this.publishCommittedDelivery(revision.delivery);
        const session = this.session(), dialogue = this.dialogue();
        const event = jsonFiles(this.path("deliveries", "events")).find((e) => e.receipt.requestId === session?.activeRequestId &&
            e.delivery.inputId === dialogue.latestInputId &&
            e.delivery.revision === this.load().revision);
        if (event &&
            (!existsSync(this.path("deliveries", "records", `${event.delivery.id}.json`)) ||
                dialogue.activeDeliveryId !== event.delivery.id))
            this.publishCommittedDelivery(event.delivery);
    }
    commit(baseRevision, state, delivery, operationId, requestId, bodyHash, afterHead) {
        const previous = this.findReceipt(operationId);
        if (previous) {
            check(previous.bodyHash === bodyHash, "IDEMPOTENCY_CONFLICT", "同一提交身份不能使用不同内容。");
            this.reconcile();
            return previous;
        }
        check(this.load().revision === baseRevision, "STALE_REVISION", "正式内容已变化，请基于当前版本重新准备。");
        const revision = `rev_${hash({ baseRevision, operationId, bodyHash }).slice(0, 32)}`;
        state = structuredClone(state);
        state.revision = revision;
        delivery = { ...delivery, revision };
        state.currentDeliveryId = delivery.id;
        for (const a of Object.values(state.artifacts))
            if (!a.revision)
                a.revision = revision;
        const receipt = {
            operationId,
            requestId,
            bodyHash,
            revision,
            deliveryId: delivery.id,
        };
        const body = { parent: baseRevision, state, receipt, delivery };
        immutable(this.path("revisions", `${revision}.json`), {
            digest: hash(body),
            body,
        });
        json(this.path("HEAD.json"), { revision });
        afterHead?.();
        this.publishCommittedDelivery(delivery);
        return receipt;
    }
    conversation(delivery, operationId, bodyHash) {
        const previous = this.findReceipt(operationId);
        if (previous) {
            check(previous.bodyHash === bodyHash, "IDEMPOTENCY_CONFLICT", "提交内容不同。");
            return previous;
        }
        const receipt = {
            operationId,
            requestId: delivery.requestId,
            bodyHash,
            revision: this.load().revision,
            deliveryId: delivery.id,
        };
        immutable(this.path("deliveries", "events", `${safeId(operationId)}.json`), {
            receipt,
            delivery,
        });
        this.publishCommittedDelivery(delivery);
        return receipt;
    }
}
export function locateWorkspace(buddyId, options = {}) {
    safeId(buddyId);
    const registryHome = resolve(options.home ?? join(homedir(), ".buddy-assistant"));
    const root = resolve(options.root ?? join(homedir(), "Buddy", "buddies"));
    const path = join(registryHome, "registry.json");
    const registry = optional(path) ?? { roots: [], buddies: {} };
    registry.roots = [
        ...new Set([
            ...registry.roots,
            ...(options.home ? [] : [join(homedir(), "Buddy", "buddies")]),
            root,
        ]),
    ];
    const candidates = new Set();
    const indexed = registry.buddies[buddyId];
    if (indexed && existsSync(join(indexed, "buddy.json")))
        candidates.add(realpathSync(indexed));
    for (const registeredRoot of registry.roots) {
        if (!existsSync(registeredRoot))
            continue;
        for (const child of readdirSync(registeredRoot, {
            withFileTypes: true,
        }).filter((x) => x.isDirectory())) {
            const candidate = join(registeredRoot, child.name);
            const meta = optional(join(candidate, "buddy.json"));
            if (meta?.buddyId === buddyId)
                candidates.add(realpathSync(candidate));
        }
    }
    if (options.workspace && existsSync(join(resolve(options.workspace), "buddy.json"))) {
        check(read(join(resolve(options.workspace), "buddy.json")).buddyId === buddyId, "BUDDY_MISMATCH", "指定目录属于另一位 Buddy。");
        candidates.add(realpathSync(resolve(options.workspace)));
    }
    const explicit = options.workspace && existsSync(join(resolve(options.workspace), "buddy.json"))
        ? realpathSync(resolve(options.workspace))
        : undefined;
    const chosen = explicit ??
        (registry.preferred?.[buddyId] && candidates.has(registry.preferred[buddyId])
            ? registry.preferred[buddyId]
            : undefined);
    if (explicit)
        registry.preferred = { ...registry.preferred, [buddyId]: explicit };
    check(chosen || candidates.size <= 1, "DUPLICATE_WORKSPACES", "发现多个相同 buddyid 的目录，请保留现场并明确选择需要恢复的目录。", { candidates: [...candidates] });
    const directory = chosen ?? [...candidates][0] ?? resolve(options.workspace ?? join(root, buddyId));
    return { path, registry, directory, existing: existsSync(join(directory, "buddy.json")) };
}
export async function openWorkspace(buddyId, options = {}) {
    safeId(buddyId);
    const registryHome = resolve(options.home ?? join(homedir(), ".buddy-assistant"));
    const root = resolve(options.root ?? join(homedir(), "Buddy", "buddies"));
    return withLock(registryHome, () => {
        const { path, registry, directory } = locateWorkspace(buddyId, options);
        if (!existsSync(join(directory, "buddy.json"))) {
            check(!existsSync(directory) || readdirSync(directory).length === 0, "DIRECTORY_NOT_EMPTY", "新工作目录必须为空，避免覆盖已有文件。");
            mkdirSync(directory, { recursive: true, mode: 0o700 });
            const workspaceId = id("workspace"), cycleId = id("cycle");
            const state = {
                schemaVersion: 1,
                rulesVersion: "1.9",
                buddyId,
                workspaceId,
                revision: "rev_initial",
                stage: STAGES[0],
                paused: false,
                targets: Object.fromEntries(Object.keys(CARDS).map((key) => [
                    key,
                    {
                        id: key,
                        cycleId,
                        status: "unstarted",
                        answerInputIds: [],
                        summary: "",
                        gaps: [],
                        evidence: [],
                    },
                ])),
                cycles: [{ id: cycleId, affected: Object.keys(CARDS), previous: [] }],
                artifacts: {},
                confirmations: [],
                sourcePlan: {
                    requiredKinds: [],
                    sourceIds: [],
                    discoveryClosed: false,
                },
                sources: {},
                serviceModelExplained: false,
                answeredInputs: [],
            };
            const body = { state };
            immutable(join(directory, "revisions", "rev_initial.json"), {
                digest: hash(body),
                body,
            });
            json(join(directory, "HEAD.json"), { revision: state.revision });
            json(join(directory, "buddy.json"), {
                buddyId,
                workspaceId,
                schemaVersion: 1,
                createdAt: now(),
            });
        }
        registry.buddies[buddyId] = directory;
        json(path, registry);
        return new Store(directory);
    });
}
