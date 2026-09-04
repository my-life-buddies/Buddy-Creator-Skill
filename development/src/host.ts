import { execFileSync } from "node:child_process";
import { basename } from "node:path";
import { BuddyError } from "./io.js";

export type Host = "codex" | "claude-code" | "workbuddy";
export interface HostDetection {
  host: Host;
  source: "argument" | "process" | "environment";
  evidence: string[];
}
const hosts: Host[] = ["codex", "claude-code", "workbuddy"];

// Read executable names only; command arguments can contain private user input.
export function ancestorExecutables(): string[] {
  const names: string[] = [];
  // Windows hosts supply their identity through the environment or --host.
  if (process.platform === "win32") return names;
  const visited = new Set<number>();
  const deadline = Date.now() + 1500;
  let pid = process.ppid;
  while (pid > 1 && names.length < 16 && !visited.has(pid) && Date.now() < deadline) {
    visited.add(pid);
    try {
      const line = execFileSync("ps", ["-p", String(pid), "-o", "ppid=", "-o", "comm="], {
        encoding: "utf8", timeout: 200, maxBuffer: 16384,
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      const match = /^(\d+)\s+(.+)$/.exec(line);
      if (!match) break;
      pid = Number(match[1]);
      names.push(match[2]!);
    } catch {
      break; // Sandboxed hosts may deny process inspection; use their environment.
    }
  }
  return names;
}

function executableHost(executable: string): Host | undefined {
  executable = executable.replaceAll("\\", "/");
  const name = basename(executable).toLowerCase().replace(/\.exe$/, "");
  if (name === "claude" || name === "claude-code" || /\/claude\/versions\/[^/]+$/.test(executable)) return "claude-code";
  if (name === "codex" || name.startsWith("codex-") && /^codex-(?:aarch64|x86_64)-/.test(name)) return "codex";
  if (/\/WorkBuddy\.app\/Contents\//i.test(executable) || /^workbuddy(?: helper(?: \([^)]+\))?)?$/i.test(name)) return "workbuddy";
  if (/\/Codex\.app\/Contents\//i.test(executable)) return "codex";
  return undefined;
}

export function detectHost(
  explicit?: string,
  env: NodeJS.ProcessEnv = process.env,
  ancestors?: string[],
): HostDetection {
  if (explicit !== undefined) {
    if (!hosts.includes(explicit as Host)) throw new BuddyError("HOST_INVALID", "支持 codex、claude-code、workbuddy。");
    return { host: explicit as Host, source: "argument", evidence: ["--host"] };
  }
  // The closest actual host wins over variables inherited from an outer host.
  for (const executable of ancestors ?? ancestorExecutables()) {
    const host = executableHost(executable);
    if (host) return { host, source: "process", evidence: [`ancestor:${host}`] };
  }
  const matches = new Map<Host, string[]>();
  const add = (host: Host, key: string) => matches.set(host, [...(matches.get(host) ?? []), key]);
  for (const key of ["CODEX_THREAD_ID", "CODEX_SESSION_ID"]) if (env[key]?.trim()) add("codex", key);
  if (env.CLAUDECODE && !["0", "false", ""].includes(env.CLAUDECODE.trim().toLowerCase())) add("claude-code", "CLAUDECODE");
  if (env.CLAUDE_CODE_SESSION_ID?.trim()) add("claude-code", "CLAUDE_CODE_SESSION_ID");
  if (env.CODEBUDDY_HOST === "workbuddy-desktop") add("workbuddy", "CODEBUDDY_HOST");
  if (env.WORKBUDDY_APP_PATH?.trim()) add("workbuddy", "WORKBUDDY_APP_PATH");
  if (matches.size === 1) {
    const [host, evidence] = [...matches][0]!;
    return { host, source: "environment", evidence };
  }
  throw new BuddyError(matches.size ? "HOST_AMBIGUOUS" : "HOST_UNDETECTED",
    matches.size ? "检测到多个宿主标记，无法确定当前调用者。" : "当前调用环境没有可识别的宿主标记。",
    {
      candidates: [...matches.keys()],
      recovery: "请当前主 agent 根据自身运行身份，用 --host codex|claude-code|workbuddy 重试；不需要创作者选择。普通终端可显式指定宿主。",
    });
}
