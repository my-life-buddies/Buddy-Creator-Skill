#!/usr/bin/env node
import { fileURLToPath } from "node:url";

const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  process.stdout.write(`${JSON.stringify({
    ok: false,
    error: { code: "NODE_VERSION", message: "Buddy 需要 Node.js 22.13 或更高版本。" },
  })}\n`);
  process.exit(1);
}

process.env.BUDDY_SKILL_ENTRY = fileURLToPath(import.meta.url);
await import(new URL("../lib/dist/cli.js", import.meta.url));
