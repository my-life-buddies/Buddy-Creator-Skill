import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

test("each protocol call runs in a new CLI process; reopened buddy resumes pending question", () => {
  const root = mkdtempSync(join(tmpdir(), "buddy-cli-")),
    cli = resolve("dist/cli.js");
  const invoke = (args: string[]) =>
    JSON.parse(execFileSync(process.execPath, [cli, ...args], { encoding: "utf8" }));
  try {
    const opened = invoke([
      "open",
      "--buddyid",
      "writer",
      "--host",
      "codex",
      "--home",
      join(root, "home"),
      "--root",
      join(root, "projects"),
      "--no-preview",
    ]);
    assert.equal(opened.next.directive, "deliver");
    const sessionId = opened.sessionId;
    function call(operation: string, args: Record<string, unknown>) {
      const path = join(root, "args.json");
      writeFileSync(path, JSON.stringify({ sessionId, ...args }));
      return invoke(["call", operation, "--workspace", opened.workspace, "--input", path]);
    }
    call("presentation_record", { deliveryId: opened.next.delivery.id });
    const ticket = call("input_reserve", { clientKey: "message-1" });
    const raw = call("input_record", {
      token: ticket.token,
      raw: "我想帮刚入职的同事写清工作周报。",
    });
    const first = call("turn_prepare", { inputId: raw.id });
    const second = call("turn_prepare", { requestId: first.requestId });
    assert.equal(first.workItem.stepId, second.workItem.stepId);
    const item = second.workItem;
    const ready = call("work_complete", {
      requestId: first.requestId,
      stepId: item.stepId,
      operationId: "output-1",
      operationEpoch: item.operationEpoch,
      baseRevision: item.baseRevision,
      contextDigest: item.contextDigest,
      output: {
        intent: "answer",
        assessments: [
          {
            targetId: "D01",
            status: "sufficient",
            summary: "帮助新同事写清周报",
            gaps: [],
            evidence: [{ type: "input", id: raw.id, hash: raw.hash, quote: raw.raw }],
          },
        ],
        delivery: {
          text: "你想到的这位新同事，在写周报时通常遇到什么困难？",
          questionTargetId: "D02",
        },
      },
    });
    assert.equal(ready.directive, "ready_to_commit");
    const commit = call("turn_commit", {
      requestId: first.requestId,
      operationId: "commit-1",
    });
    assert.equal(commit.directive, "deliver");
    const again = invoke([
      "open",
      "--buddyid",
      "writer",
      "--host",
      "codex",
      "--home",
      join(root, "home"),
      "--root",
      join(root, "elsewhere"),
      "--no-preview",
    ]);
    assert.equal(again.workspace, opened.workspace);
    assert.equal(again.next.delivery.id, commit.delivery.id);
    const state = call("project_read", {}).state;
    assert.equal(state.targets.D01.answerInputIds.length, 1);
    const takeover = invoke([
      "open",
      "--buddyid",
      "writer",
      "--host",
      "claude-code",
      "--takeover",
      "--home",
      join(root, "home"),
      "--root",
      join(root, "projects"),
      "--no-preview",
    ]);
    assert.equal(takeover.workspace, opened.workspace);
    assert.equal(takeover.operationEpoch, opened.operationEpoch + 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fast CLI uses stdin, defaults to task-local projects, keeps existing roots, and pending reads never lock", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "buddy-fast-cli-")));
  const cli = resolve("dist/cli.js");
  const invoke = (args: string[], input = {}, cwd = root) =>
    JSON.parse(
      execFileSync(process.execPath, [cli, ...args], {
        cwd,
        input: JSON.stringify(input),
        encoding: "utf8",
      }),
    );
  try {
    const registry = join(root, "registry");
    const located = invoke(["locate", "--buddyid", "trial", "--home", registry]);
    assert.equal(located.existing, false);
    assert.equal(existsSync(registry), false);
    assert.equal(located.workspace, join(root, ".buddy", "buddies", "trial"));
    const opened = invoke([
      "open",
      "--buddyid",
      "trial",
      "--home",
      registry,
      "--host",
      "codex",
      "--no-preview",
    ]);
    assert.equal(opened.workspaceAccess.relation, "within_task_directory");
    const call = (op: string, args = {}) =>
      invoke(["call", op, "--workspace", opened.workspace, "--input", "-"], {
        sessionId: opened.sessionId,
        ...args,
      });
    const d = call("turn_begin", {
      clientKey: "msg-1",
      raw: "帮助同事写周报",
      presentedDeliveryId: opened.next.delivery.id,
    });
    const i = d.context.input;
    const result = {
      intent: "answer",
      assessments: [
        {
          targetId: "D01",
          status: "sufficient",
          summary: i.raw,
          gaps: [],
          evidence: [{ type: "input", id: i.id, hash: i.hash, quote: i.raw }],
        },
      ],
      delivery: { text: "你想到的同事写周报时，最需要帮助的是哪个地方？", questionTargetId: "D02" },
    };
    const done = call("turn_finish", { workToken: d.workToken, output: result });
    assert.equal(done.directive, "deliver");
    assert.equal(
      call("turn_finish", { workToken: d.workToken, output: result }).receipt.revision,
      done.receipt.revision,
    );
    mkdirSync(join(opened.workspace, ".writer-lock"));
    writeFileSync(join(opened.workspace, ".writer-lock", "canary"), "do not touch");
    assert.deepEqual(call("input_pending").inputs, []);
    assert.equal(call("input_history").inputs[0].input.raw, i.raw);
    assert.ok(existsSync(join(opened.workspace, ".writer-lock", "canary")));
    const read = invoke(["call", "project_read", "--workspace", opened.workspace]);
    assert.equal(read.state.revision, done.receipt.revision);
    assert.ok(call("schema_read", { fields: ["confirmation"] }).fields.confirmation);
    const elsewhere = join(root, "elsewhere");
    mkdirSync(elsewhere);
    const again = invoke(["locate", "--buddyid", "trial", "--home", registry], {}, elsewhere);
    assert.equal(again.workspace, opened.workspace);
    assert.equal(again.workspaceAccess.relation, "outside_task_directory");
    assert.equal(again.workspaceAccess.permissionVerified, false);
    assert.equal(existsSync(join(elsewhere, ".buddy")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("locate recognizes a future workspace through the macOS temporary-directory alias", () => {
  const root = mkdtempSync(join(tmpdir(), "buddy-alias-"));
  try {
    const aliased = root.startsWith('/private/') ? root.slice('/private'.length) : root;
    const result = JSON.parse(execFileSync(process.execPath, [resolve('dist/cli.js'), 'locate', '--buddyid', 'alias-writer',
      '--home', join(aliased, 'registry'), '--root', join(aliased, 'projects')], { encoding: 'utf8', cwd: root }));
    assert.equal(result.existing, false);
    assert.equal(result.workspaceAccess.relation, 'within_task_directory');
    assert.ok(!result.workspaceAccess.setup.includes('复用了'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
