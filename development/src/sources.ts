import { spawn } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { XMLParser } from "fast-xml-parser";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import mammoth from "mammoth";
import {
  atomic,
  BuddyError,
  check,
  hash,
  immutable,
  json,
  jsonFiles,
  now,
  optional,
  read,
  safeId,
  withLock,
} from "./io.js";
import type { SourceKind, SourceManifest } from "./types.js";
import type { Store } from "./store.js";
import { assertSourceSupported, assertWebSourceSupported } from "./source-policy.js";

export type SourceRequest = {
  operationId: string;
  kind: SourceKind;
  uri?: string;
  title?: string;
  text?: string;
  locale?: string;
  limit?: number;
};
export type Part = { text: string; locator: string };
export function run(
  program: string,
  args: string[],
  timeout = 120000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "",
      err = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(
        new BuddyError(
          "TOOL_TIMEOUT",
          "资料工具运行超时，已保留来源，可重试当前步骤。",
        ),
      );
    }, timeout);
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString();
      if (Buffer.byteLength(out) > 64000000) {
        child.kill();
        reject(
          new BuddyError("TOOL_OUTPUT_LIMIT", "工具输出过大，请拆分这份资料。"),
        );
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      err = (err + chunk.toString()).slice(-12000);
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(
        new BuddyError("TOOL_UNAVAILABLE", `无法运行 ${program}。`, {
          error: e.message,
        }),
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      code === 0
        ? resolve(out)
        : reject(
            new BuddyError("SOURCE_TOOL_FAILED", `${program} 处理失败。`, {
              exitCode: code,
              error: err,
            }),
          );
    });
  });
}
export function chunkParts(parts: Part[]): SourceManifest["chunks"] {
  const chunks: SourceManifest["chunks"] = [];
  for (const p of parts) {
    for (let start = 0; start < p.text.length; start += 4000) {
      const text = p.text.slice(start, start + 4000);
      if (!text.trim()) continue;
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
function visibleText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value))
    return value
      .map((v) =>
        typeof v === "string"
          ? v
          : v &&
              typeof v === "object" &&
              ["text", "input_text", "output_text"].includes(
                (v as { type: string }).type,
              )
            ? String((v as { text: unknown }).text ?? "")
            : "",
      )
      .filter(Boolean)
      .join("\n");
  return "";
}
export function parseHistory(text: string): Part[] {
  let records: unknown[];
  try {
    const v = JSON.parse(text);
    records = Array.isArray(v) ? v : (v.messages ?? v.turns ?? [v]);
  } catch {
    records = text
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }
  const parts: Part[] = [];
  for (let i = 0; i < records.length; i++) {
    const r = records[i] as Record<string, any>;
    if (r.isMeta || r.isSidechain) continue;
    let role: string | undefined,
      content = "";
    if (
      r.type === "event_msg" &&
      ["user_message", "agent_message"].includes(r.payload?.type)
    ) {
      role = r.payload.type === "user_message" ? "user" : "assistant";
      content = visibleText(r.payload.message);
    } else {
      const m = r.message ?? r;
      role =
        m.role ?? (["user", "assistant"].includes(r.type) ? r.type : undefined);
      content = visibleText(m.content ?? m.text);
    }
    if (!["user", "assistant"].includes(role ?? "") || !content.trim())
      continue;
    content = content
      .replace(
        /<(environment_context|permissions|recommended_plugins|in-app-browser-context)>[\s\S]*?<\/\1>/g,
        "",
      )
      .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, "[已移除密钥]")
      .replace(/(Bearer\s+)[A-Za-z0-9._-]{16,}/gi, "$1[已移除]");
    if (content.trim())
      parts.push({
        text: `${role}: ${content.trim()}`,
        locator: `message=${i + 1};role=${role}`,
      });
  }
  check(
    parts.length,
    "HISTORY_EMPTY",
    "这份文件中没有支持的可见用户或助手消息。",
  );
  return parts;
}
export async function nativeMedia(
  store: Store,
  command: "ocr" | "transcribe",
  path: string,
  locale = "zh-CN",
): Promise<Part[]> {
  check(
    process.platform === "darwin",
    "MACOS_REQUIRED",
    "扫描件和本地转写使用 macOS 系统能力。",
  );
  const source = fileURLToPath(
    new URL("../native/Media.swift", import.meta.url),
  );
  const cacheIdentity = {
    command,
    inputHash: hash(readFileSync(path)),
    locale,
    helperHash: hash(readFileSync(source)),
  };
  const resultPath = store.path(
    "source-jobs",
    "media-results",
    `${hash(cacheIdentity)}.json`,
  );
  const cached = optional<{
    identity: typeof cacheIdentity;
    parts: Part[];
    digest: string;
  }>(resultPath);
  if (cached) {
    check(
      hash(cached.identity) === hash(cacheIdentity) &&
        cached.digest === hash(cached.parts),
      "MEDIA_RESULT_CHANGED",
      "已保存的媒体识别结果被改动，请保留现场核对。",
    );
    return cached.parts;
  }
  const directory = store.path(
    ".tools",
    hash(readFileSync(source)).slice(0, 16),
  );
  const executable = join(directory, "BuddyMedia");
  if (!existsSync(executable)) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const info = fileURLToPath(
      new URL("../native/Info.plist", import.meta.url),
    );
    await run(
      "/usr/bin/xcrun",
      [
        "swiftc",
        "-parse-as-library",
        "-O",
        "-module-cache-path",
        join(directory, "module-cache"),
        source,
        "-Xlinker",
        "-sectcreate",
        "-Xlinker",
        "__TEXT",
        "-Xlinker",
        "__info_plist",
        "-Xlinker",
        info,
        "-o",
        executable,
      ],
      180000,
    );
  }
  const output = JSON.parse(
    await run(executable, [command, path, locale], 1800000),
  ) as { parts: Part[] };
  check(
    output.parts?.some((p) => p.text.trim()),
    "EMPTY_TRANSCRIPT",
    "系统未识别到有效文字，不能标为已读取。",
  );
  immutable(resultPath, {
    identity: cacheIdentity,
    parts: output.parts,
    digest: hash(output.parts),
  });
  return output.parts;
}
async function parseLocal(
  store: Store,
  path: string,
  request: SourceRequest,
): Promise<{
  parts: Part[];
  original: Buffer;
  name: string;
  parser: string;
  warnings: string[];
  extras?: { name: string; data: Buffer }[];
}> {
  check(existsSync(path), "FILE_MISSING", "找不到选定的来源文件。", { path });
  const kind = request.kind,
    extension = extname(path).toLowerCase();
  let warnings: string[] = [];
  if (kind === "skill" && statSync(path).isDirectory()) {
    const files: Record<string, Uint8Array> = {},
      parts: Part[] = [];
    function visit(directory: string) {
      for (const name of readdirSync(directory)) {
        const file = join(directory, name);
        if (lstatSync(file).isSymbolicLink()) continue;
        const stat = statSync(file);
        if (stat.isDirectory()) {
          if (![".git", "node_modules"].includes(name)) visit(file);
        } else {
          check(
            Object.keys(files).length < 5000,
            "SOURCE_SIZE",
            "Skill 文件数超过5000，请限定来源范围。",
          );
          const rel = relative(path, file);
          const data = readFileSync(file);
          files[rel] = data;
          if (/\.(md|txt|json|ya?ml|py|[cm]?js|ts|sh)$/i.test(rel))
            parts.push({ text: data.toString("utf8"), locator: `file=${rel}` });
        }
      }
    }
    visit(path);
    check(parts.length, "SKILL_EMPTY", "Skill 中没有可整理的文本。");
    return {
      parts,
      original: Buffer.from(zipSync(files)),
      name: `${basename(path)}.zip`,
      parser: "skill-archive-v1",
      warnings,
    };
  }
  check(
    statSync(path).isFile(),
    "SOURCE_NOT_FILE",
    "请提供具体文件，或使用 Skill 类型导入目录。",
  );
  check(
    statSync(path).size <= 512 * 1024 * 1024,
    "SOURCE_SIZE",
    "单个来源暂支持512MB以内；请按章节或媒体片段拆分。",
  );
  const original = readFileSync(path),
    name = basename(path);
  let parts: Part[] = [];
  let parser = "text-v1";
  const extras: { name: string; data: Buffer }[] = [];
  if (kind === "history") {
    parts = parseHistory(original.toString("utf8"));
    parser = "selected-visible-messages-v1";
    warnings = [
      "原始会话文件保留在本机归档；交接只包含已清理的可见消息，不包含工具调用和宿主上下文。",
    ];
  } else if (
    kind === "scan" ||
    [".png", ".jpg", ".jpeg", ".heic", ".tiff"].includes(extension)
  ) {
    parts = await nativeMedia(store, "ocr", path);
    parser = "apple-vision-v1";
  } else if (kind === "audio" || kind === "video") {
    let audioPath = path;
    let hasAudio = true;
    if (kind === "video") {
      const probe = JSON.parse(
        await run("ffprobe", [
          "-v",
          "error",
          "-show_entries",
          "stream=codec_type:format=duration",
          "-of",
          "json",
          path,
        ]),
      ) as { streams: { codec_type: string }[]; format: { duration: string } };
      hasAudio = probe.streams.some((s) => s.codec_type === "audio");
      if (hasAudio) {
        audioPath = store.path(".tools", `${hash(original)}.wav`);
        mkdirSync(join(audioPath, ".."), { recursive: true });
        await run(
          "ffmpeg",
          [
            "-nostdin",
            "-v",
            "error",
            "-y",
            "-i",
            path,
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            audioPath,
          ],
          600000,
        );
      }
      const frames = store.path(
        ".tools",
        `frames-${hash(original).slice(0, 24)}`,
      );
      mkdirSync(frames, { recursive: true });
      await run(
        "ffmpeg",
        [
          "-nostdin",
          "-v",
          "error",
          "-y",
          "-i",
          path,
          "-vf",
          "fps=1/10,scale=1200:-1",
          "-q:v",
          "3",
          join(frames, "frame-%06d.jpg"),
        ],
        600000,
      );
      let fallback = false;
      let names = readdirSync(frames)
        .filter((n) => n.endsWith(".jpg"))
        .sort();
      if (!names.length) {
        fallback = true;
        await run("ffmpeg", [
          "-nostdin",
          "-v",
          "error",
          "-y",
          "-i",
          path,
          "-frames:v",
          "1",
          join(frames, "frame-000001.jpg"),
        ]);
        names = ["frame-000001.jpg"];
      }
      for (let n = 0; n < names.length; n++) {
        const file = join(frames, names[n]!);
        extras.push({
          name: `frame-${String(n).padStart(6, "0")}.jpg`,
          data: readFileSync(file),
        });
        try {
          const recognized = await nativeMedia(store, "ocr", file);
          parts.push(
            ...recognized.map((p) => ({
              text: p.text,
              locator: `frame=${n + 1};time≈${fallback ? 0 : Math.min(n * 10 + 5, Number(probe.format.duration))}s`,
            })),
          );
        } catch (error) {
          if (
            !(error instanceof BuddyError) ||
            error.code !== "EMPTY_TRANSCRIPT"
          )
            throw error;
        }
      }
      extras.push({
        name: "frame-index.json",
        data: Buffer.from(
          JSON.stringify({
            sampling:
              "one frame per 10 seconds, midpoint selection; first frame fallback for short videos",
            durationSeconds: Number(probe.format.duration),
            frames: names.length,
          }),
        ),
      });
      warnings.push(
        "画面按每10秒一帧抽样归档并识别文字；非文字视觉含义未自动归纳，原视频完整保留，必要时需结合原片校准。",
      );
    }
    if (hasAudio) {
      try {
        parts.push(
          ...(await nativeMedia(
            store,
            "transcribe",
            audioPath,
            request.locale,
          )),
        );
      } catch (error) {
        if (
          kind !== "video" ||
          !(error instanceof BuddyError) ||
          error.code !== "EMPTY_TRANSCRIPT" ||
          !parts.length
        )
          throw error;
        warnings.push("音轨未识别到文字；本来源仅采用已识别的画面文字。");
      }
    }
    parser =
      kind === "video"
        ? "apple-speech+sampled-vision-v1"
        : "apple-speech-on-device-v1";
    warnings.push(
      "自动转写可能存在识别误差；知识归纳须引用时间位置并由创作者校准。",
    );
  } else if (extension === ".pdf") {
    const pdf = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const loading = pdf.getDocument({
      data: new Uint8Array(original),
      useSystemFonts: true,
    });
    const document = await loading.promise;
    let scanned = false;
    for (let i = 1; i <= document.numPages; i++) {
      const page = await document.getPage(i);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ");
      if (!text.trim()) scanned = true;
      parts.push({ text, locator: `page=${i}` });
    }
    await loading.destroy();
    if (scanned) {
      const ocr = await nativeMedia(store, "ocr", path);
      parts = parts.map((p) =>
        p.text.trim() ? p : (ocr.find((o) => o.locator === p.locator) ?? p),
      );
      warnings.push("无文本页面已使用系统 OCR；请校准识别结果。");
    }
    parser = "pdfjs+vision-v1";
  } else if (extension === ".docx") {
    parts = [
      {
        text: (await mammoth.extractRawText({ buffer: original })).value,
        locator: "document",
      },
    ];
    parser = "mammoth-v1";
  } else if ([".doc", ".rtf"].includes(extension)) {
    parts = [
      {
        text: await run("/usr/bin/textutil", [
          "-convert",
          "txt",
          "-stdout",
          path,
        ]),
        locator: "document",
      },
    ];
    parser = "macos-textutil-v1";
  } else if (
    kind === "mindmap" ||
    [".xmind", ".mm", ".opml"].includes(extension)
  ) {
    let data: unknown;
    if (extension === ".xmind") {
      const entries = unzipSync(original);
      check(
        entries["content.json"] || entries["content.xml"],
        "MINDMAP_FORMAT",
        "XMind 文件缺少 content.json / content.xml。",
      );
      data = entries["content.json"]
        ? JSON.parse(strFromU8(entries["content.json"]))
        : new XMLParser({ ignoreAttributes: false }).parse(
            strFromU8(entries["content.xml"]!),
          );
    } else
      data =
        extension === ".json"
          ? JSON.parse(original.toString("utf8"))
          : new XMLParser({ ignoreAttributes: false }).parse(
              original.toString("utf8"),
            );
    function walk(value: unknown, path: string) {
      if (!value || typeof value !== "object") return;
      if (Array.isArray(value)) {
        value.forEach((v, i) => walk(v, `${path}/${i}`));
        return;
      }
      for (const [key, v] of Object.entries(value)) {
        if (
          ["title", "@_TEXT", "@_text", "#text"].includes(key) &&
          typeof v === "string"
        )
          parts.push({ text: v, locator: `node=${path}/${key}` });
        else walk(v, `${path}/${key}`);
      }
    }
    walk(data, "root");
    parser = "mindmap-tree-v1";
  } else {
    check(
      [
        ".md",
        ".txt",
        ".json",
        ".jsonl",
        ".csv",
        ".yaml",
        ".yml",
        ".html",
        ".htm",
      ].includes(extension) ||
        kind === "oral" ||
        kind === "skill",
      "UNSUPPORTED_FORMAT",
      "该文件格式尚未提供解析器。",
      { extension },
    );
    parts = [{ text: original.toString("utf8"), locator: "document" }];
  }
  check(
    parts.some((p) => p.text.trim()),
    "EMPTY_SOURCE",
    "没有解析到可用内容，不能标为已读取。",
  );
  return { parts, original, name, parser, warnings, extras };
}
export async function readableWeb(
  url: string,
): Promise<{ parts: Part[]; original: Buffer; title: string }> {
  let parsed = new URL(url);
  const signal = AbortSignal.timeout(30000);
  let response: Response;
  for (let redirects = 0; ; redirects++) {
    assertWebSourceSupported(parsed.href);
    response = await fetch(parsed, {
      signal, redirect: "manual",
      headers: { "User-Agent": "BuddyCreator/0.2 (+local creator archive)" },
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get("location");
    await response.body?.cancel();
    check(location && redirects < 5, "WEB_REDIRECT", "网页跳转过多或缺少目标地址。");
    parsed = new URL(location, parsed);
  }
  check(
    response.ok,
    "WEB_FETCH_FAILED",
    `网页返回 ${response.status}，内容没有导入。`,
  );
  check(
    Number(response.headers.get("content-length") ?? 0) <= 20000000,
    "SOURCE_SIZE",
    "网页超过20MB。",
  );
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of response.body!) {
    size += chunk.byteLength;
    check(size <= 20000000, "SOURCE_SIZE", "网页超过20MB。");
    chunks.push(chunk);
  }
  const original = Buffer.concat(chunks);
  const { document } = parseHTML(original.toString("utf8"));
  document
    .querySelectorAll("script,style,nav,footer")
    .forEach((e) => e.remove());
  const article = new Readability(document as unknown as Document).parse();
  const text =
    article?.textContent?.trim() ?? document.body.textContent?.trim() ?? "";
  return {
    parts: text.length > 40 ? [{ text, locator: `url=${response.url}` }] : [],
    original,
    title: article?.title ?? parsed.hostname,
  };
}
export function enqueueSource(
  store: Store,
  request: SourceRequest,
): SourceManifest {
  assertSourceSupported(request.kind);
  if (request.kind === "webpage" && request.uri) assertWebSourceSupported(request.uri);
  safeId(request.operationId);
  check(
    request.uri || request.text?.trim(),
    "SOURCE_LOCATION",
    "请提供来源路径、网址或口述原文。",
  );
  const path = store.path(
      "source-jobs",
      "requests",
      `${request.operationId}.json`,
    ),
    previous = optional<{ digest: string; sourceId: string }>(path);
  if (previous) {
    check(
      previous.digest === hash(request),
      "IDEMPOTENCY_CONFLICT",
      "同一来源操作身份不能更换内容。",
    );
    return store.source(previous.sourceId);
  }
  const sourceId = `source_${hash(request.operationId).slice(0, 24)}`,
    jobId = `job_${hash(request.operationId).slice(0, 24)}`;
  const manifest: SourceManifest = {
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
    processing: {
      acquisition: "queued",
      parsing: "not_started",
      semanticReview: "requires_host_calibration",
    },
  };
  immutable(store.path("source-jobs", `${jobId}.json`), request);
  immutable(
    store.path("sources", sourceId, "versions", "queued.json"),
    manifest,
  );
  json(store.path("sources", sourceId, "HEAD.json"), { version: "queued" });
  immutable(path, { digest: hash(request), sourceId });
  return manifest;
}
export async function processSource(store: Store, sourceId: string) {
  return withLock(
    store.path("source-jobs", "locks", safeId(sourceId)),
    async () => {
      const previous = store.source(sourceId);
      if (previous.status === "ready") return previous;
      assertSourceSupported(previous.kind);
      const completed = jsonFiles<SourceManifest>(
        store.path("sources", sourceId, "versions"),
      ).find((v) => v.status === "ready" && v.jobId === previous.jobId);
      if (completed) {
        check(
          completed.files.every(
            (f) =>
              existsSync(store.path(f.path)) &&
              hash(readFileSync(store.path(f.path))) === f.hash,
          ),
          "SOURCE_ASSET_CHANGED",
          "已完成来源的文件被改动，已停止恢复。",
        );
        json(store.path("sources", sourceId, "HEAD.json"), {
          version: completed.version,
        });
        return completed;
      }
      const request = read<SourceRequest>(
        store.path("source-jobs", `${previous.jobId}.json`),
      );
      assertSourceSupported(request.kind);
      const manifest: SourceManifest = {
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
      immutable(
        store.path("sources", sourceId, "versions", `${manifest.version}.json`),
        manifest,
      );
      json(store.path("sources", sourceId, "HEAD.json"), {
        version: manifest.version,
      });
      const save = (name: string, data: Buffer | string) => {
        const bytes = typeof data === "string" ? Buffer.from(data) : data,
          digest = hash(bytes),
          path = `sources/blobs/${digest}/${name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
        if (!existsSync(store.path(path))) atomic(store.path(path), bytes);
        manifest.files.push({ path, hash: digest, bytes: bytes.length });
        return path;
      };
      try {
        let parts: Part[] = [];
        manifest.files = [];
        manifest.warnings = [];
        if (request.kind === "oral") {
          parts = [{ text: request.text!, locator: "creator-oral" }];
          save("oral.txt", request.text!);
          manifest.parser = "oral-verbatim-v1";
          manifest.processing!.acquisition = "complete";
          manifest.processing!.parsing = "running";
        } else if (request.kind === "webpage") {
          const result = await readableWeb(request.uri!);
          parts = result.parts;
          save("original.html", result.original);
          manifest.title = request.title ?? result.title;
          manifest.parser = "readability-v1";
          manifest.processing!.acquisition = "complete";
          manifest.processing!.parsing = "running";
        } else {
          const requestedPath = resolve(request.uri!);
          const acquiredPath = store.path(
            "source-jobs",
            "acquired",
            `${previous.jobId}.json`,
          );
          let acquired = optional<{
            path: string;
            name: string;
            sha256?: string;
          }>(acquiredPath);
          if (
            !acquired &&
            existsSync(requestedPath) &&
            statSync(requestedPath).isFile()
          ) {
            check(
              statSync(requestedPath).size <= 512 * 1024 * 1024,
              "SOURCE_SIZE",
              "单个来源暂支持512MB以内。",
            );
            const data = readFileSync(requestedPath),
              name = basename(requestedPath);
            const path =
              request.kind === "history"
                ? store.path(".private-sources", `${hash(data)}-${name}`)
                : store.path(save(`original-${name}`, data));
            if (request.kind === "history") atomic(path, data);
            acquired = { path, name, sha256: hash(data) };
            immutable(acquiredPath, acquired);
          }
          if (acquired) {
            const expected =
              acquired.sha256 ?? /([a-f0-9]{64})/.exec(acquired.path)?.[1];
            check(
              expected && hash(readFileSync(acquired.path)) === expected,
              "SOURCE_ASSET_CHANGED",
              "已归档原件发生改变，不能在新版本中默默接纳改动。",
            );
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
          if (acquired) manifest.processing!.acquisition = "complete";
          manifest.processing!.parsing = "running";
          const result = await parseLocal(
            store,
            acquired?.path ?? requestedPath,
            request,
          );
          parts = result.parts;
          if (request.kind === "history")
            save(
              "original-visible-messages.json",
              JSON.stringify(parts, null, 2),
            );
          else if (!acquired) save(`original-${result.name}`, result.original);
          manifest.parser = result.parser;
          manifest.processing!.acquisition = "complete";
          manifest.warnings = result.warnings;
          for (const extra of result.extras ?? []) save(extra.name, extra.data);
        }
        manifest.chunks = chunkParts(parts);
        check(
          manifest.chunks.length,
          "EMPTY_SOURCE",
          "没有取得可引用的完整文本。",
        );
        save(
          "fulltext.txt",
          parts.map((p) => `[${p.locator}]\n${p.text}`).join("\n\n"),
        );
        save("chunks.json", JSON.stringify(manifest.chunks, null, 2));
        manifest.status = "ready";
        manifest.processing!.parsing = "complete";
        manifest.version = `sourcev_${hash({ files: manifest.files, parser: manifest.parser }).slice(0, 28)}`;
      } catch (error) {
        manifest.status = "failed";
        if (manifest.processing!.acquisition === "running")
          manifest.processing!.acquisition = manifest.files.length
            ? "partial"
            : "failed";
        if (manifest.processing!.parsing === "running")
          manifest.processing!.parsing = manifest.chunks.length
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
      immutable(
        store.path("sources", sourceId, "versions", `${manifest.version}.json`),
        manifest,
      );
      json(store.path("sources", sourceId, "HEAD.json"), {
        version: manifest.version,
      });
      return manifest;
    },
  );
}
