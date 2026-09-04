import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(readFileSync(join(root, 'package.json'))).version;
const temporary = realpathSync(mkdtempSync(join(tmpdir(), 'buddy-skill-install-')));
const archive = join(root, 'release', `buddy-creator-${version}.zip`);
let workspace, cli;
try {
  execFileSync('/usr/bin/unzip', ['-q', archive, '-d', temporary]);
  const skill = join(temporary, 'buddy-creator');
  const manifest = JSON.parse(readFileSync(join(skill, 'skill-manifest.json')));
  for (const item of manifest.files) {
    const bytes = readFileSync(join(skill, item.path));
    assert.equal(bytes.length, item.bytes, item.path);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), item.sha256, item.path);
  }
  cli = join(skill, 'scripts/buddy');
  function invoke(args, input) {
    return JSON.parse(execFileSync(cli, args, { cwd: temporary, input: input ? JSON.stringify(input) : undefined,
      encoding: 'utf8', env: { ...process.env, NODE_PATH: '', BUDDY_SKILL_ENTRY: '' } }));
  }
  const common = ['--buddyid', 'skill-package-smoke', '--home', join(temporary, 'registry'), '--root', join(temporary, 'projects')];
  const located = invoke(['locate', ...common]);
  assert.equal(located.existing, false);
  const opened = invoke(['open', ...common, '--host', 'codex', '--no-browser']);
  workspace = opened.workspace;
  assert.equal(opened.next.directive, 'deliver');
  assert.ok(existsSync(opened.protocol.hostGuide));
  assert.ok(opened.protocol.entrypoint.startsWith(temporary));
  assert.equal(opened.protocol.model, 'host-main-agent');
  assert.ok(!opened.protocol.operations.some((operation) => ['handoff_start', 'handoff_status'].includes(operation)));
  assert.ok(!opened.protocol.sourcePolicy.supportedKinds.includes('xiaohongshu'));
  assert.equal((await fetch(opened.preview.url)).status, 200);
  const snapshot = await (await fetch(`${opened.preview.url}api/snapshot`)).json();
  assert.equal(snapshot.buddyId, 'skill-package-smoke');
  assert.ok(!('codingHandoff' in snapshot));
  const write = await fetch(`${opened.preview.url}api/snapshot`, { method: 'POST', body: '{}' });
  assert.equal(write.status, 405);
  const delivery = opened.next.delivery;
  invoke(['call', 'presentation_record', '--workspace', workspace, '--input', '-'], { sessionId: opened.sessionId, deliveryId: delivery.id });
  const begin = invoke(['call', 'turn_begin', '--workspace', workspace, '--input', '-'], {
    sessionId: opened.sessionId, clientKey: 'message-1', raw: '我想帮刚入职的同事把工作周报写清楚。', presentedDeliveryId: delivery.id,
  });
  assert.equal(begin.directive, 'host_work');
  const input = begin.context.input;
  const output = { intent: 'answer', assessments: [{ targetId: 'D01', status: 'sufficient', summary: '帮助新同事写清工作周报', gaps: [],
    evidence: [{ type: 'input', id: input.id, hash: input.hash, quote: input.raw }] }],
    delivery: { text: '你想到的这位新同事，在写周报时最常遇到什么困难？', questionTargetId: 'D02' } };
  const finished = invoke(['call', 'turn_finish', '--workspace', workspace, '--input', '-'], { sessionId: opened.sessionId, workToken: begin.workToken, output });
  assert.equal(finished.directive, 'deliver');
  const updated = await (await fetch(`${opened.preview.url}api/snapshot`)).json();
  assert.notEqual(updated.revision, snapshot.revision);
  for (const host of ['claude-code', 'workbuddy']) {
    const reopened = invoke(['open', ...common, '--host', host, '--takeover', '--no-browser']);
    assert.equal(reopened.workspace, workspace);
    assert.equal(reopened.preview.url, opened.preview.url);
    assert.equal(reopened.next.delivery.id, finished.delivery.id);
  }
  assert.equal(invoke(['stop', '--workspace', workspace]).stopped, true);
  const restarted = invoke(['open', ...common, '--host', 'workbuddy', '--no-browser']);
  assert.equal(restarted.preview.url, opened.preview.url);
  assert.equal((await fetch(restarted.preview.url)).status, 200);
  console.log(JSON.stringify({ ok: true, version, archive, manifestFiles: manifest.files.length,
    standaloneInstall: true, turnSaved: true, previewUpdated: true, readonly: true, fixedAddressOnRestart: true,
    hostParameters: ['codex', 'claude-code', 'workbuddy'], actualThreeHostAcceptance: false }, null, 2));
} finally {
  if (workspace && cli) {
    try { execFileSync(cli, ['stop', '--workspace', workspace], { encoding: 'utf8', cwd: temporary }); } catch {}
  }
  rmSync(temporary, { recursive: true, force: true });
}
