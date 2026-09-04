import { test } from "node:test";
import assert from "node:assert/strict";
import { detectHost } from "../src/host.js";

test("detects all three hosts from their runtime markers without a host argument", () => {
  for (const [env, host] of [
    [{ CODEX_THREAD_ID: "thread" }, "codex"],
    [{ CODEX_SESSION_ID: "session" }, "codex"],
    [{ CLAUDECODE: "1" }, "claude-code"],
    [{ CLAUDE_CODE_SESSION_ID: "session" }, "claude-code"],
    [{ CODEBUDDY_HOST: "workbuddy-desktop" }, "workbuddy"],
    [{ WORKBUDDY_APP_PATH: "/Applications/WorkBuddy.app/Contents/Resources/app.asar" }, "workbuddy"],
  ] as const) {
    assert.equal(detectHost(undefined, env, []).host, host);
  }
});

test("nearest host process wins over inherited environment and an outer host", () => {
  assert.equal(detectHost(undefined, { CODEX_THREAD_ID: "outer" }, [
    "/bin/zsh", "/Users/test/.local/share/claude/versions/2.1.137",
    "/Applications/Codex.app/Contents/MacOS/Codex",
  ]).host, "claude-code");
  assert.equal(detectHost(undefined, { CLAUDECODE: "1" }, [
    "/bin/zsh", "/Applications/WorkBuddy.app/Contents/Frameworks/WorkBuddy Helper.app/Contents/MacOS/WorkBuddy Helper",
  ]).host, "workbuddy");
  assert.equal(detectHost(undefined, {}, ["/bin/zsh", "/opt/bin/codex"]).host, "codex");
});

test("unknown and ambiguous callers never silently become Codex", () => {
  assert.throws(() => detectHost(undefined, {
    CODEX_HOME: "/config", ANTHROPIC_API_KEY: "not-an-identity",
    CLAUDECODE: "0", TERM_PROGRAM: "vscode", CODEBUDDY_HOST: "another-product",
  }, ["/usr/bin/node", "/tmp/workbuddy-notes/tool", "/bin/zsh"]), { code: "HOST_UNDETECTED" });
  assert.throws(() => detectHost(undefined, { CODEX_THREAD_ID: "outer", CLAUDECODE: "1" }, []), { code: "HOST_AMBIGUOUS" });
});

test("explicit host is an override and diagnostics never expose environment values", () => {
  assert.equal(detectHost("workbuddy", { CODEX_THREAD_ID: "private-thread" }, ["/opt/bin/codex"]).source, "argument");
  assert.throws(() => detectHost("other", {}, []), { code: "HOST_INVALID" });
  const detected = detectHost(undefined, { CODEX_THREAD_ID: "private-thread" }, []);
  assert.deepEqual(detected.evidence, ["CODEX_THREAD_ID"]);
  assert.equal(JSON.stringify(detected).includes("private-thread"), false);
});
