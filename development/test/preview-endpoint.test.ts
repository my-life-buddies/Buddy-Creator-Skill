import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BuddyError, json } from "../src/io.js";
import { servePreview, startPreview } from "../src/preview.js";
import { openWorkspace } from "../src/store.js";

async function close(server: Server) {
  if (!server.listening) return;
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

async function listen(server: Server, port = 0) {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return address.port;
}

async function fixture(t: TestContext, buddyId = "preview-endpoint") {
  const root = mkdtempSync(join(tmpdir(), "buddy-preview-endpoint-"));
  const servers: Server[] = [];
  const cleanups: Array<() => Promise<unknown>> = [];
  t.after(async () => {
    try {
      for (const cleanup of cleanups) await cleanup();
    } finally {
      await Promise.all(servers.map(close));
      rmSync(root, { recursive: true, force: true });
    }
  });
  const store = await openWorkspace(buddyId, {
    home: join(root, "registry"),
    root: join(root, "projects"),
  });
  return {
    root,
    store,
    servers,
    cleanups,
    async start(port = 0) {
      const preview = await servePreview(store, port);
      servers.push(preview.server);
      return preview;
    },
  };
}

async function snapshot(url: string) {
  const response = await fetch(`${url}api/snapshot`);
  assert.equal(response.status, 200);
  return response.json() as Promise<{ buddyId: string; revision: string }>;
}

test("preview restart preserves the full address even when the process record is removed", async (t) => {
  const f = await fixture(t);
  const original = await f.start();
  assert.ok(existsSync(f.store.path("preview-endpoint.json")));
  assert.equal((await snapshot(original.url)).buddyId, f.store.load().buddyId);

  await close(original.server);
  rmSync(f.store.path("preview-server.json"), { force: true });
  const restarted = await f.start();

  assert.equal(restarted.url, original.url, "port and token path must both survive a restart");
  assert.deepEqual(await snapshot(original.url), await snapshot(restarted.url));
  assert.equal((await snapshot(original.url)).revision, f.store.load().revision);
});

test("a legacy preview record is adopted without invalidating its existing URL", async (t) => {
  const f = await fixture(t, "legacy-preview");
  const reservation = createServer();
  f.servers.push(reservation);
  const port = await listen(reservation);
  await close(reservation);
  const token = "a".repeat(48);
  const legacyUrl = `http://127.0.0.1:${port}/p/${token}/`;
  json(f.store.path("preview-server.json"), {
    pid: process.pid,
    url: legacyUrl,
    token,
  });

  const preview = await f.start();
  assert.equal(preview.url, legacyUrl);
  assert.ok(existsSync(f.store.path("preview-endpoint.json")));
  assert.equal((await snapshot(legacyUrl)).buddyId, "legacy-preview");
});

test("an occupied saved port fails without changing the URL or stopping its current owner", async (t) => {
  const f = await fixture(t, "occupied-preview");
  const original = await f.start();
  const savedEndpoint = readFileSync(f.store.path("preview-endpoint.json"), "utf8");
  await close(original.server);

  const otherService = createServer((_request, response) => response.end("other-local-service"));
  f.servers.push(otherService);
  await listen(otherService, Number(new URL(original.url).port));

  await assert.rejects(
    () => f.start(),
    (error: unknown) => error instanceof BuddyError && error.code === "PREVIEW_PORT_IN_USE",
  );
  assert.equal(readFileSync(f.store.path("preview-endpoint.json"), "utf8"), savedEndpoint);
  assert.equal(otherService.listening, true);
  assert.equal(await (await fetch(original.url)).text(), "other-local-service");

  await close(otherService);
  const recovered = await f.start();
  assert.equal(recovered.url, original.url);
  assert.equal((await snapshot(original.url)).buddyId, "occupied-preview");
});

test("an explicit new port becomes the saved address for subsequent starts", async (t) => {
  const f = await fixture(t, "migrated-preview");
  const original = await f.start();
  const reservation = createServer();
  f.servers.push(reservation);
  const replacementPort = await listen(reservation);
  assert.notEqual(replacementPort, Number(new URL(original.url).port));
  await close(reservation);
  await close(original.server);

  const migrated = await f.start(replacementPort);
  assert.equal(Number(new URL(migrated.url).port), replacementPort);
  assert.equal((await snapshot(migrated.url)).buddyId, "migrated-preview");
  await close(migrated.server);

  const restarted = await f.start();
  assert.equal(restarted.url, migrated.url);
});

test("invalid legacy addresses are rejected before any health-check request", async (t) => {
  const f = await fixture(t, "invalid-preview");
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => {
    requests++;
    throw new Error("untrusted addresses must not be fetched");
  });
  const token = "b".repeat(48);
  for (const url of [
    `https://example.invalid/p/${token}/`,
    `http://127.0.0.1:60001@elsewhere.invalid/p/${token}/`,
    `http://127.0.0.1:60001/p/${"c".repeat(48)}/`,
  ]) {
    json(f.store.path("preview-server.json"), { pid: process.pid, url, token });
    const original = readFileSync(f.store.path("preview-server.json"), "utf8");
    await assert.rejects(
      () => startPreview(f.store, false),
      (error: unknown) => error instanceof BuddyError && error.code === "PREVIEW_ADDRESS_INVALID",
    );
    assert.equal(requests, 0);
    assert.equal(readFileSync(f.store.path("preview-server.json"), "utf8"), original);
    assert.equal(existsSync(f.store.path("preview-endpoint.json")), false);
  }
});

test("an endpoint copied from another workspace is refused without affecting that preview", async (t) => {
  const owner = await fixture(t, "endpoint-owner");
  const other = await fixture(t, "endpoint-other");
  const live = await owner.start();
  const endpoint = JSON.parse(readFileSync(owner.store.path("preview-endpoint.json"), "utf8"));
  json(other.store.path("preview-endpoint.json"), endpoint);
  const copied = readFileSync(other.store.path("preview-endpoint.json"), "utf8");

  await assert.rejects(
    () => other.start(),
    (error: unknown) => error instanceof BuddyError && error.code === "PREVIEW_ADDRESS_INVALID",
  );
  assert.equal(readFileSync(other.store.path("preview-endpoint.json"), "utf8"), copied);
  assert.equal(live.server.listening, true);
  assert.equal((await snapshot(live.url)).buddyId, "endpoint-owner");
});

test("compiled preview lifecycle shares one process between concurrent starts and preserves its URL after stop", { timeout: 25_000 }, async (t) => {
  const f = await fixture(t, "preview-process-lifecycle");
  // Import the build so startPreview launches the actual adjacent dist/cli.js.
  const built = await import("../dist/preview.js");
  f.cleanups.push(() => built.stopPreview(f.store));
  const startWithIdentity = async () => {
    const opened = await built.startPreview(f.store, false);
    const response = await fetch(`${opened.url}api/health`, { signal: AbortSignal.timeout(2000) });
    assert.equal(response.status, 200);
    const identity = await response.json() as { pid: number; workspaceId: string };
    return { ...opened, ...identity };
  };
  // Wait for both calls even if one fails, so cleanup never races a pending start.
  const concurrent = await Promise.allSettled([startWithIdentity(), startWithIdentity()]);
  for (const result of concurrent) {
    if (result.status === "rejected") throw result.reason;
  }
  const [first, second] = concurrent.map((result) => {
    assert.equal(result.status, "fulfilled");
    return result.value;
  });
  assert.ok(first && second);
  assert.equal(first.url, second.url);
  assert.equal(first.pid, second.pid);
  assert.notEqual(first.pid, process.pid);
  assert.equal(first.workspaceId, f.store.load().workspaceId);

  const stopped = await built.stopPreview(f.store);
  assert.equal(stopped.stopped, true);
  assert.equal(stopped.status, "stopped");
  // A successful bind proves stop returned only after the listening port was released.
  const releasedPort = createServer();
  f.servers.push(releasedPort);
  await listen(releasedPort, Number(new URL(first.url).port));
  await close(releasedPort);

  const restarted = await startWithIdentity();
  assert.equal(restarted.url, first.url);
  assert.notEqual(restarted.pid, first.pid);
  assert.equal((await snapshot(first.url)).buddyId, "preview-process-lifecycle");
});

test("compiled preview lifecycle reports a saved-port conflict without replacing the address", { timeout: 20_000 }, async (t) => {
  const f = await fixture(t, "preview-process-port-conflict");
  const built = await import("../dist/preview.js");
  f.cleanups.push(() => built.stopPreview(f.store));
  const original = await built.startPreview(f.store, false);
  const savedEndpoint = readFileSync(f.store.path("preview-endpoint.json"), "utf8");
  assert.equal((await built.stopPreview(f.store)).stopped, true);

  const otherService = createServer((_request, response) => {
    response.writeHead(503);
    response.end("independent-http-service");
  });
  f.servers.push(otherService);
  await listen(otherService, Number(new URL(original.url).port));
  await assert.rejects(
    () => built.startPreview(f.store, false),
    (error: unknown) => typeof error === "object" && error !== null &&
      "code" in error && error.code === "PREVIEW_PORT_IN_USE",
  );
  assert.equal(readFileSync(f.store.path("preview-endpoint.json"), "utf8"), savedEndpoint);
  assert.equal(otherService.listening, true);
  assert.equal(await (await fetch(original.url)).text(), "independent-http-service");
});

test("upgrading the preview process keeps its address and loads the new runtime", async (t) => {
  const f = await fixture(t, "upgrade-preview");
  const built = await import("../dist/preview.js");
  const original = await built.startPreview(f.store, false);
  f.cleanups.push(() => built.stopPreview(f.store));
  const processPath = f.store.path("preview-server.json");
  const oldInfo = JSON.parse(readFileSync(processPath, "utf8"));
  json(processPath, { ...oldInfo, runtimeVersion: "0.1.17" });
  const reopened = await built.startPreview(f.store, false);
  const newInfo = JSON.parse(readFileSync(processPath, "utf8"));
  assert.equal(reopened.url, original.url);
  assert.notEqual(newInfo.pid, oldInfo.pid);
  assert.equal(newInfo.runtimeVersion, JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version);
  assert.equal((await snapshot(original.url)).buddyId, "upgrade-preview");
});
