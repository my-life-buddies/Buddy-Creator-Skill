#!/usr/bin/env node
import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join, resolve, relative, isAbsolute, dirname, basename } from "node:path";
import { Store, openWorkspace, locateWorkspace } from "./store.js";
import {
  BuddyError,
  check,
  hash,
  immutable,
  json,
  now,
  optional,
  read,
  safeId,
  withLock,
} from "./io.js";
import { publishDraft, startPreview, stopPreview, servePreview, previewSnapshot } from "./preview.js";
import type { SourceRequest } from "./sources.js";
import { resultJsonSchema } from "./schema.js";
import { CARDS, ROLE, SERVICE_RULES, SOURCE_KINDS } from "./rules.js";
import { gates } from "./domain.js";
import { detectHost } from "./host.js";
import { withCompletion, completionSnapshot } from "./completion.js";
import { assertSourceSupported, sourcePolicy, sourceView, sourceNeedsHostResult } from "./source-policy.js";
import type { Session, WorkEnvelope, WorkItem } from "./types.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    buddyid: { type: "string" },
    "creation-key": { type: "string" },
    workspace: { type: "string" },
    root: { type: "string" },
    home: { type: "string" },
    host: { type: "string" },
    session: { type: "string" },
    input: { type: "string" },
    "no-browser": { type: "boolean" },
    "no-preview": { type: "boolean" },
    takeover: { type: "boolean" },
    port: { type: "string" },
    help: { type: "boolean" },
    version: { type: "boolean" },
  },
});
const output = (value: unknown) =>
  process.stdout.write(
    `${JSON.stringify({ protocolVersion: "1", ...(value as Record<string, unknown>) }, null, 2)}\n`,
  );
function worker(store: Store, sourceId: string) {
  const child = spawn(
    process.execPath,
    [
      fileURLToPath(new URL("./cli.js", import.meta.url)),
      "source-worker",
      sourceId,
      "--workspace",
      store.directory,
    ],
    { detached: true, stdio: "ignore" },
  );
  child.on("error", () => undefined);
  child.unref();
}
function protocol(store: Store) {
  return {
    role: ROLE,
    workspace: store.directory,
    rulebook: fileURLToPath(new URL("../rules/interview.md", import.meta.url)),
    hostGuide: fileURLToPath(new URL("../integrations/HOST_GUIDE.md", import.meta.url)),
    model: "host-main-agent",
    sourcePolicy,
    distribution: "skill",
    entrypoint: process.env.BUDDY_SKILL_ENTRY ?? fileURLToPath(new URL("./cli.js", import.meta.url)),
    completion: "local-deliverables",
    operations: [
      "turn_begin",
      "turn_finish",
      "turn_continue",
      "schema_read",
      "input_reserve",
      "input_pending",
      "input_history",
      "input_record",
      "turn_prepare",
      "work_complete",
      "turn_commit",
      "artifact_confirm",
      "work_retry",
      "turn_pause",
      "turn_resume",
      "turn_cancel",
      "draft_publish",
      "presentation_record",
      "source_import",
      "source_status",
      "source_retry",
      "source_read",
      "context_read",
      "project_read",
      "validate",
      "completion_status",
      "finalize",
      "export",
    ],
    invocation:
      "buddy call turn_begin|turn_finish --workspace <workspace> --input - < JSON via stdin; use the returned workToken, do not assemble internal envelopes",
    rulesVersion: "1.9",
  };
}
async function call(store: Store, operation: string, args: Record<string, any>) {
  if (
    [
      "project_read",
      "input_pending",
      "input_history",
      "schema_read",
      "validate",
      "handoff_prepare",
      "completion_status",
      "source_status",
      "source_read",
      "context_read",
      "protocol",
    ].includes(operation)
  ) {
    if (operation === "input_pending") return { inputs: store.pendingInputs(args.sessionId) };
    if (operation === "input_history")
      return store.inputHistory(args.sessionId, args.offset, args.limit);
    if (operation === "schema_read") {
      const properties = (resultJsonSchema as any).properties;
      const fields = args.fields ?? ["intent", "assessments", "delivery"];
      check(
        Array.isArray(fields) &&
          fields.every((k: unknown) => typeof k === "string" && Object.hasOwn(properties, k)),
        "SCHEMA_FIELDS",
        "fields 应为结果顶层字段名数组。",
      );
      return {
        digest: hash(resultJsonSchema),
        fields: Object.fromEntries(fields.map((k: string) => [k, properties[k]])),
      };
    }
    if (operation === "project_read")
      return {
        state: store.load(),
        session: store.session(),
        dialogue: store.dialogue(),
      };
    if (operation === "protocol")
      return {
        ...protocol(store),
        outputSchema: resultJsonSchema,
        platformRules: SERVICE_RULES,
        targetCards: CARDS,
      };
    if (operation === "validate")
      return {
        revision: store.load().revision,
        stages: Object.fromEntries(
          ["definition", "knowledge", "methods", "service"].map((s) => [
            s,
            gates(store.load(), store, s as any),
          ]),
        ),
      };
    if (operation === "handoff_prepare") return (await import("./handoff.js")).handoffStatus(store);
    if (operation === "completion_status") return {
      ...(await import("./handoff.js")).handoffStatus(store),
      completion: completionSnapshot(store),
    };
    if (operation === "source_status")
      return args.sourceId
        ? { source: sourceView(store.source(args.sourceId, args.version)) }
        : { sources: store.sourceList().map(sourceView) };
    if (operation === "source_read") {
      const source = store.source(args.sourceId, args.version);
      const offset = Number(args.offset ?? 0),
        limit = Math.min(Number(args.limit ?? 8), 30);
      check(
        Number.isInteger(offset) && offset >= 0 && Number.isInteger(limit) && limit > 0,
        "PAGE_ARGUMENT",
        "来源分页参数无效。",
      );
      return {
        sourceId: source.id,
        version: source.version,
        chunks: source.chunks.slice(offset, offset + limit),
        nextOffset: offset + limit < source.chunks.length ? offset + limit : null,
        total: source.chunks.length,
      };
    }
    if (operation === "context_read") {
      const item = read<WorkItem>(
        store.path("runtime-work", "items", `${safeId(args.stepId)}.json`),
      );
      const context = read<Record<string, unknown>>(item.contextRef);
      check(hash(context) === item.contextDigest, "CONTEXT_CHANGED", "工作上下文已被修改。");
      let section: unknown = args.section ? context[args.section] : context;
      if (args.path) {
        check(
          Array.isArray(args.path) &&
            args.path.every(
              (k: unknown) =>
                typeof k === "string" && !["__proto__", "constructor", "prototype"].includes(k),
            ),
          "CONTEXT_PATH",
          "path 应是字段名数组。",
        );
        for (const key of args.path) {
          check(
            section && typeof section === "object" && Object.hasOwn(section, key),
            "CONTEXT_PATH",
            "上下文字段不存在。",
          );
          section = (section as Record<string, unknown>)[key];
        }
      }
      const text = JSON.stringify(section, null, 2);
      check(text !== undefined, "CONTEXT_PATH", "上下文字段不存在。");
      if (args.offset !== undefined) {
        const offset = Number(args.offset),
          limit = Number(args.limit ?? 60000);
        check(
          Number.isInteger(offset) &&
            offset >= 0 &&
            Number.isInteger(limit) &&
            limit > 0 &&
            limit <= 120000,
          "PAGE_ARGUMENT",
          "上下文分页参数无效。",
        );
        return {
          text: text.slice(offset, offset + limit),
          offset,
          nextOffset: offset + limit < text.length ? offset + limit : null,
          totalCharacters: text.length,
          contextDigest: item.contextDigest,
        };
      }
      check(
        text.length <= 120000,
        "CONTEXT_BUDGET",
        "上下文较长，请按 section、path 或 offset 分页读取，全文不会截断。",
        { contextRef: item.contextRef, totalCharacters: text.length },
      );
      return { context: section, contextDigest: item.contextDigest };
    }
  }
  return withLock(store.directory, async () => {
    check(
      typeof args.sessionId === "string",
      "SESSION_REQUIRED",
      "写操作需要 open 返回的 sessionId。",
    );
    store.requireSession(args.sessionId);
    if (["turn_begin", "turn_finish", "turn_continue"].includes(operation)) {
      const { TurnAPI } = await import("./turn-api.js");
      const api = new TurnAPI(store);
      try {
        if (operation === "turn_begin") return await api.begin(args as any);
        if (operation === "turn_finish") return await api.finish(args as any);
        const requestId = args.requestId ?? store.session()?.activeRequestId;
        return requestId
          ? await api.next(requestId, args.sessionId, args.knownRulesDigest)
          : withCompletion(store, { directive: "await_user" });
      } finally {
        api.close();
      }
    }
    store.reconcile();
    if (operation === "input_reserve")
      return store.reserve(args.sessionId, args.clientKey, args.replyToDeliveryId);
    if (operation === "input_record")
      return store.record(args.sessionId, args.token, args.raw, args.annotation);
    if (operation === "presentation_record")
      return store.presentation(args.deliveryId, "host_reported");
    if (operation === "draft_publish")
      return publishDraft(store, args.sessionId, {
        stepId: args.stepId,
        contextDigest: args.contextDigest,
        sequence: args.sequence,
        markdown: args.markdown,
        title: args.title,
      });
    if (operation === "source_import") {
      assertSourceSupported(args.kind);
      const request: SourceRequest = {
        operationId: args.operationId,
        kind: args.kind,
        uri: args.uri,
        title: args.title,
        text: args.text,
        locale: args.locale,
        limit: args.limit,
        hostResult: args.hostResult,
      };
      const { enqueueSource } = await import("./sources.js");
      const source = enqueueSource(store, request);
      worker(store, source.id);
      return {
        directive: source.status === "ready" ? "await_user" : "tool_pending",
        sourceId: source.id,
        jobId: source.jobId,
        status: source.status,
        message: "资料进度会显示在预览中；就绪后回到对话继续。",
      };
    }
    if (operation === "source_retry") {
      const source = store.source(args.sourceId);
      assertSourceSupported(source.kind);
      check(!sourceNeedsHostResult(source), "HOST_MEDIA_REQUIRED",
        "请由宿主工具补齐音视频结果，以新的 operationId 重新 source_import；旧任务内容已冻结，重复重试不能补出缺失结果。",
        { source: sourceView(source), recovery: sourcePolicy.mediaRecovery });
      worker(store, source.id);
      return {
        directive: "tool_pending",
        sourceId: source.id,
        jobId: source.jobId,
      };
    }
    if (operation === "export" || operation === "handoff_export")
      return (await import("./handoff.js")).exportHandoff(store, args.operationId);
    if (operation === "finalize")
      return withCompletion(store, {
        directive: "await_user",
        ...(await import("./handoff.js")).handoffStatus(store),
      });
    const { Workflow } = await import("./workflow.js");
    const workflow = new Workflow(store);
    try {
      if (operation === "turn_prepare")
        return await (args.requestId
          ? workflow.next(args.requestId)
          : workflow.prepare(
              args.sessionId,
              args.inputId,
              args.pipeline ?? "interview",
              args.conflictReview,
            ));
      if (operation === "work_complete")
        return await workflow.complete(args.requestId, args as WorkEnvelope);
      if (operation === "turn_commit" || operation === "artifact_confirm") {
        if (args.output) {
          const directive = await workflow.complete(args.requestId, args as WorkEnvelope);
          if (directive.directive !== "ready_to_commit") return directive;
        }
        return await workflow.commit(args.requestId, args.commitOperationId ?? args.operationId);
      }
      if (operation === "work_retry") return await workflow.retry(args.requestId);
      if (operation === "turn_cancel") return workflow.cancel(args.sessionId);
      if (operation === "turn_pause") return workflow.pause(args.sessionId, true);
      if (operation === "turn_resume") {
        workflow.pause(args.sessionId, false);
        return args.requestId ? await workflow.next(args.requestId) : { directive: "await_user" };
      }
      throw new BuddyError("UNKNOWN_OPERATION", "未知操作。", { operation });
    } finally {
      workflow.close();
    }
  });
}
async function main() {
  if (values.version) {
    output({
      version: read<{ version: string }>(fileURLToPath(new URL("../package.json", import.meta.url)))
        .version,
      rulesVersion: "1.9",
    });
    return;
  }
  const command = positionals[0] ?? "help";
  if (values.help || command === "help") {
    output({
      name: "Buddy Assistant",
      usage: [
        "buddy locate --buddyid <id>",
        "buddy open [--creation-key <stable-start-key>]",
        "buddy open --workspace <existing-directory>",
        "buddy open --buddyid <existing-id>",
        "buddy call <operation> --workspace <directory> --input <json-file>",
        "buddy doctor",
        "buddy serve --workspace <directory>",
        "buddy stop --workspace <directory>",
      ],
      note: "自动识别调用宿主；--host 仅用于显式覆盖。采访与修正发生在宿主主对话，浏览器只读。使用 open 返回的会话和宿主指南继续。",
    });
    return;
  }
  if (command === "doctor") {
    const tools = await Promise.all(
      ["node", "xcrun"].map(async (program) => {
        try {
          const { run } = await import("./sources.js");
          const version = await run(
            program,
            ["--version"],
            10000,
          );
          return { program, available: true, required: program === "node", purpose: program === "node" ? "local-workflow-preview" : "optional-scan-ocr", version: version.slice(0, 160) };
        } catch {
          return { program, available: program === "node", required: program === "node", purpose: program === "node" ? "local-workflow-preview" : "optional-scan-ocr" };
        }
      }),
    );
    output({
      platform: process.platform,
      node: process.version,
      tools,
      hosts: {
        codex: existsSync(join(process.env.HOME ?? "", ".local/bin/codex")),
        "claude-code": existsSync(join(process.env.HOME ?? "", ".local/bin/claude")),
        workbuddy: existsSync("/Applications/WorkBuddy.app"),
      },
      sourceKinds: SOURCE_KINDS,
      sourcePolicy,
      note: "音视频由宿主实际可用的工具处理，Buddy 只保存返回结果，不检测或安装音视频系统资源。扫描件 OCR 可选使用 Apple Vision 与 Xcode Command Line Tools。",
    });
    return;
  }
  if (command === "locate") {
    check(values.buddyid, "BUDDY_ID_REQUIRED", "请提供 buddyid。");
    const located = locateWorkspace(values.buddyid, {
      home: values.home,
      root: values.root ?? join(process.cwd(), ".buddy", "buddies"),
      workspace: values.workspace,
    });
    output({
      buddyId: values.buddyid,
      workspace: located.directory,
      existing: located.existing,
      workspaceAccess: workspaceAccess(located.directory, located.existing),
    });
    return;
  }
  if (command === "open") {
    const existingProject = values.workspace
      ? optional<{ buddyId: string }>(join(resolve(values.workspace), "buddy.json")) : undefined;
    const creationKey = values["creation-key"];
    check(creationKey === undefined || creationKey.trim().length > 0,
      "CREATION_KEY_EMPTY", "启动重试标识不能为空；无需创作者提供，由宿主保存本次启动身份。");
    const generatedId = creationKey
      ? `buddy-${hash({ root: physicalPath(values.root ?? join(process.cwd(), ".buddy", "buddies")), creationKey }).slice(0, 24)}`
      : `buddy-${randomUUID()}`;
    const buddyId = values.buddyid ?? existingProject?.buddyId ?? generatedId;
    const hostDetection = detectHost(values.host);
    const host = hostDetection.host;
    const store = await openWorkspace(buddyId, {
      home: values.home,
      root: values.root ?? join(process.cwd(), ".buddy", "buddies"),
      workspace: values.workspace,
    });
    const session = await withLock(store.directory, () => {
      const s = store.connect(host, values.session, values.takeover);
      store.reconcile();
      return s;
    });
    const state = store.load();
    let next: Record<string, unknown>;
    if (session.activeRequestId) {
      const { Workflow } = await import("./workflow.js");
      const workflow = new Workflow(store);
      try {
        const { compactWork } = await import("./turn-api.js");
        next = compactWork(store, await withLock(store.directory, () => workflow.next(session.activeRequestId!, false)), session.id);
      } catch (error) {
        next = {
          directive: "needs_reprepare",
          message: error instanceof Error ? error.message : String(error),
          requestId: session.activeRequestId,
        };
      } finally {
        workflow.close();
      }
    } else if (store.dialogue().activeDeliveryId)
      next = store.deliveryDirective(store.dialogue().activeDeliveryId);
    else {
      const text = readFileSync(new URL("../integrations/OPENING.md", import.meta.url), "utf8").trim();
      const delivery = {
        id: `delivery_initial_${state.workspaceId}`,
        requestId: "initial",
        revision: state.revision,
        text,
        hash: hash(text),
        kind: "content" as const,
        question: {
          id: "question_initial",
          targetId: "D01",
          cycleId: state.targets.D01!.cycleId,
          mode: "ordinary" as const,
        },
      };
      await withLock(store.directory, () => store.publishCommittedDelivery(delivery));
      next = store.deliveryDirective(delivery.id);
    }
    next = await withLock(store.directory, () => withCompletion(store, next));
    const preview = values["no-preview"]
      ? undefined
      : await startPreview(store, !values["no-browser"]);
    for (const source of store.sourceList().map(sourceView))
      if (["queued", "running"].includes(source.status)) worker(store, source.id);
    output({
      buddyId: state.buddyId,
      host,
      hostDetection,
      workspace: store.directory,
      sessionId: session.id,
      operationEpoch: session.epoch,
      workspaceAccess: workspaceAccess(store.directory),
      preview,
      sourceIssues: store.sourceList().map(sourceView).filter((s) => s.status === "failed"),
      protocol: protocol(store),
      next,
    });
    return;
  }
  check(values.workspace, "WORKSPACE_REQUIRED", "请提供 open 返回的工作目录。");
  const store = new Store(resolve(values.workspace));
  if (command === "serve") {
    const info = await servePreview(store, values.port ? Number(values.port) : 0);
    const shutdown = () => {
      info.server.close(() => process.exit(0));
      info.server.closeAllConnections();
    };
    process.once("SIGTERM", shutdown);
    process.once("SIGINT", shutdown);
    output({ url: info.url, readonly: true });
    return;
  }
  if (command === "stop") {
    output(await stopPreview(store));
    return;
  }
  if (command === "source-worker") {
    check(positionals[1], "SOURCE_ID_REQUIRED", "缺少来源标识。");
    const { SourceWorkflow } = await import("./source-workflow.js");
    const sourceWorkflow = new SourceWorkflow(store);
    try {
      output({ source: await sourceWorkflow.run(positionals[1]) });
    } finally {
      sourceWorkflow.close();
    }
    return;
  }
  if (command === "call") {
    check(positionals[1], "OPERATION_REQUIRED", "缺少操作名称。");
    const raw = readFileSync(values.input && values.input !== "-" ? values.input : 0, "utf8");
    check(raw.length <= 1000000, "INPUT_SIZE", "单次协议输入超过1MB。");
    let args: Record<string, any>;
    try {
      args = raw.trim() ? JSON.parse(raw) : {};
    } catch {
      throw new BuddyError(
        "INPUT_JSON",
        "输入不是有效 JSON；请通过 --input - 从标准输入传入 JSON 对象。",
      );
    }
    check(
      args && typeof args === "object" && !Array.isArray(args),
      "INPUT_JSON",
      "协议输入须为 JSON 对象。",
    );
    output(await call(store, positionals[1], args));
    return;
  }
  throw new BuddyError("UNKNOWN_COMMAND", "未知命令。");
}
function physicalPath(path: string) {
  let current = resolve(path);
  const missing: string[] = [];
  while (!existsSync(current)) {
    missing.unshift(basename(current));
    const parent = dirname(current);
    if (parent === current) return resolve(path);
    current = parent;
  }
  return join(realpathSync(current), ...missing);
}
function workspaceAccess(directory: string, existing = true) {
  const rel = relative(physicalPath(process.cwd()), physicalPath(directory));
  const within = rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith("../"));
  return {
    relation: within ? "within_task_directory" : "outside_task_directory",
    taskDirectory: process.cwd(),
    workspace: directory,
    permissionVerified: false,
    setup: within
      ? "项目位于当前任务目录内；遵守宿主实际工具权限。"
      : `${existing ? "复用了已登记项目。" : "将在所选目录创建项目。"}开始采访前，将此工作目录作为宿主项目打开，或通过宿主提供的机制仅授权此目录写入。CLI 不能授予权限；不要为规避权限另建同名项目，也不要反复提交额外审批。`,
    registry: "仅 open 使用本机注册表；每轮 turn_begin/turn_finish 不访问注册表。",
  };
}
main().catch((error) => {
  output({
    ok: false,
    error: {
      code: error instanceof BuddyError ? error.code : "INTERNAL_ERROR",
      message: error instanceof Error ? error.message : String(error),
      details: error instanceof BuddyError ? error.details : undefined,
    },
  });
  process.exitCode = 1;
});
