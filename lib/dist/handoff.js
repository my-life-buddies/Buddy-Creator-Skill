import { existsSync, readFileSync } from "node:fs";
import { strToU8, zipSync } from "fflate";
import { bookConfirmed, bookIds, gates } from "./domain.js";
import { atomic, check, hash, immutable, read, safeId } from "./io.js";
import { STAGES } from "./rules.js";
import { serviceDiagram } from "./service-diagram.js";
export function handoffStatus(store, state = store.load()) {
    return {
        revision: state.revision,
        ready: STAGES.every((s) => bookConfirmed(state, s) && gates(state, store, s).every((g) => g.pass)),
        stages: STAGES.map((stage) => ({
            stage,
            bookletConfirmed: bookConfirmed(state, stage),
            gates: gates(state, store, stage),
        })),
    };
}
export function collectDeliverables(store, state = store.load()) {
    const status = handoffStatus(store, state);
    check(status.ready, "HANDOFF_NOT_READY", "四份手册尚未完成确认，或来源与业务门槛未通过。", { status });
    const files = {};
    const put = (name, value) => {
        files[name] = strToU8(typeof value === "string" ? value : JSON.stringify(value, null, 2));
    };
    put("project-state.json", state);
    put("confirmations.json", state.confirmations);
    put("service-blueprint.json", state.artifacts["service.blueprint"] ?? {});
    put("service-diagram.svg", serviceDiagram(state.artifacts["service.blueprint"]?.data ?? {}, state.buddyId));
    const books = STAGES.map((stage) => ({
        stage,
        text: bookIds(stage)
            .map((id) => {
            const a = state.artifacts[id];
            return `# ${a.title}\n\n${a.markdown}\n`;
        })
            .join("\n"),
    }));
    for (const b of books)
        put(`booklets/${b.stage}.md`, b.text);
    put("BUDDY_MANUAL.md", books.map((b) => `# ${b.stage}\n\n${b.text}`).join("\n---\n\n"));
    const inputIds = new Set(), refs = [];
    for (const a of Object.values(state.artifacts))
        refs.push(...a.evidence, ...a.dependencies);
    for (const target of Object.values(state.targets))
        refs.push(...target.evidence);
    for (const c of state.confirmations) {
        inputIds.add(c.inputId);
        refs.push(...c.evidence);
        const d = store.delivery(c.deliveryId);
        put(`confirmations/deliveries/${d.id}.json`, d);
    }
    for (const ref of refs)
        if (ref.type === "input")
            inputIds.add(ref.id);
    for (const target of Object.values(state.targets))
        for (const id of target.answerInputIds)
            inputIds.add(id);
    for (const c of state.cycles) {
        if (c.inputId)
            inputIds.add(c.inputId);
        for (const target of c.previous)
            for (const id of target.answerInputIds)
                inputIds.add(id);
    }
    let revision = state.revision;
    while (revision) {
        const r = store.revision(revision);
        if (r.delivery) {
            put(`interview/deliveries/${r.delivery.id}.json`, r.delivery);
            if (r.delivery.inputId)
                inputIds.add(r.delivery.inputId);
        }
        revision = r.parent;
    }
    // Include the actual question/confirmation a retained input replied to, including non-commit deliveries.
    for (const id of inputIds) {
        const input = store.input(id);
        if (input.replyToDeliveryId) {
            const reply = store.delivery(input.replyToDeliveryId);
            put(`interview/deliveries/${reply.id}.json`, reply);
            if (reply.inputId)
                inputIds.add(reply.inputId);
        }
    }
    const inputs = [...inputIds].map((id) => store.input(id));
    put("interview/inputs.json", inputs);
    put("provenance.json", refs);
    const sources = [];
    for (const id of new Set([
        ...state.sourcePlan.sourceIds,
        ...refs.filter((ref) => ref.type === "source").map((ref) => ref.id),
    ])) {
        check(state.sources[id], "SOURCE_NOT_ADOPTED", "所选来源尚未进入正式版本。", { id });
        const source = store.source(id, state.sources[id].version);
        check(source.status === "ready", "SOURCE_NOT_READY", "来源还未完整处理。");
        sources.push(source);
        put(`sources/manifests/${source.id}.json`, source);
        for (const file of source.files) {
            check(existsSync(store.path(file.path)), "SOURCE_ASSET_MISSING", "来源原件或派生文件缺失，不能生成完整本地成果。", { path: file.path });
            const data = readFileSync(store.path(file.path));
            check(hash(data) === file.hash && data.length === file.bytes, "SOURCE_ASSET_CHANGED", "来源文件已被改动，不能按原版本导出。", { path: file.path });
            files[file.path] = data;
        }
    }
    put("sources/catalog.json", sources.map((s) => ({
        id: s.id,
        version: s.version,
        title: s.title,
        kind: s.kind,
        uri: s.uri,
    })));
    put("CONTENTS.md", `# Buddy ${state.buddyId}\n\n本地成果固定在版本 ${state.revision}。\n\n从 BUDDY_MANUAL.md 阅读整体定义，四份分册位于 booklets/。project-state.json、confirmations.json 和 provenance.json 保留版本、明确确认和来源依据。sources/ 包含本次选定并纳入正式版本的原件、全文、分块与目录。interview/ 保存登记到 Buddy、与本版本相关的采访输入和回复，不是宿主完整聊天备份。历史会话仅保留用户选定范围中的可见消息，不包含宿主系统上下文。\n\n这些文件描述创作者已确认的 Buddy；后续修改在主对话中提出，并生成新的确认版本。\n`);
    const manifest = {
        buddyId: state.buddyId,
        revision: state.revision,
        complete: true,
        files: Object.entries(files).map(([path, data]) => ({
            path,
            bytes: data.length,
            sha256: hash(Buffer.from(data)),
        })),
    };
    put("MANIFEST.json", manifest);
    return { files, manifest };
}
/** Optional explicit export. Normal completion writes a local directory, never a ZIP. */
export function exportHandoff(store, operationId, options = {}) {
    safeId(operationId);
    const state = options.revision ? store.revision(options.revision).state : store.load();
    const { files } = collectDeliverables(store, state);
    const archive = Buffer.from(zipSync(files, { level: 6 }));
    const path = store.path("exports", `${state.buddyId}-${state.revision}.zip`);
    const receipt = {
        operationId,
        revision: state.revision,
        path,
        bytes: archive.length,
        sha256: hash(archive),
        fileCount: Object.keys(files).length,
    };
    const previousPath = store.path("exports", "receipts", `${operationId}.json`);
    if (existsSync(previousPath)) {
        const previous = read(previousPath);
        check(previous.revision === state.revision, "IDEMPOTENCY_CONFLICT", "同一导出身份对应不同版本。");
        return previous;
    }
    atomic(path, archive);
    immutable(previousPath, receipt);
    return receipt;
}
