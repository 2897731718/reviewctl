import assert from "node:assert/strict";
import test from "node:test";

import { detectAgent } from "../dist/index.js";

const spec = {
  provider: "codex",
  command: "codex",
  versionArgs: ["--version"],
};

test("reports an available agent and captures its version", () => {
  const health = detectAgent(spec, () => ({
    status: 0,
    stdout: "codex-cli 1.2.3\n",
    stderr: "",
  }));

  assert.deepEqual(health, {
    provider: "codex",
    command: "codex",
    available: true,
    version: "codex-cli 1.2.3",
  });
});

test("reports an unavailable agent without throwing", () => {
  const error = Object.assign(new Error("spawn codex ENOENT"), { code: "ENOENT" });
  const health = detectAgent(spec, () => ({
    status: null,
    stdout: "",
    stderr: "",
    error,
  }));

  assert.equal(health.available, false);
  assert.match(health.error ?? "", /ENOENT/u);
});
