import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ClaudeAdapter } from "../dist/adapters/claude.js";
import { CodexAdapter } from "../dist/adapters/codex.js";
import { REVIEW_OUTPUT_SCHEMA } from "../dist/protocol/schema.js";

const payload = { phase: "independent_review", summary: "ok", findings: [] };
const schema = { type: "object" };

test("Codex adapter enforces read-only ephemeral execution", async () => {
  const artifactDir = await mkdtemp(join(tmpdir(), "reviewctl-codex-"));
  let invocation;
  const adapter = new CodexAdapter(async (command, args, options) => {
    invocation = { command, args, options };
    const outputIndex = args.indexOf("--output-last-message");
    await writeFile(args[outputIndex + 1], JSON.stringify(payload), "utf8");
    return { exitCode: 0, stdout: "events", stderr: "" };
  }, testEnvironment());
  const result = await adapter.run(request(artifactDir));

  assert.equal(invocation.command, "codex");
  assert.ok(invocation.args.includes("--ephemeral"));
  assert.ok(invocation.args.includes("--ignore-user-config"));
  assert.ok(invocation.args.includes("--ignore-rules"));
  assert.deepEqual(pair(invocation.args, "--sandbox"), ["--sandbox", "read-only"]);
  assert.deepEqual(pair(invocation.args, "--config"), ["--config", "shell_environment_policy.inherit=none"]);
  assert.equal(invocation.options.stdin, "review prompt");
  assert.equal(invocation.options.env.OPENAI_API_KEY, "openai-test-key");
  assert.equal(invocation.options.env.UNRELATED_SECRET, undefined);
  assert.deepEqual(JSON.parse(result.rawOutput), payload);
});

test("Codex adapter makes schemas strict and removes optional null placeholders", async () => {
  const artifactDir = await mkdtemp(join(tmpdir(), "reviewctl-codex-schema-"));
  let outputSchema;
  const strictPayload = {
    phase: "independent_review",
    summary: "ok",
    findings: [{
      title: "Issue",
      severity: "P2",
      confidence: "high",
      category: "test",
      evidence: [{ path: "src/a.ts", line: null, observation: "Evidence" }],
      impact: "Impact",
      reproduction: null,
      recommendation: "Fix",
      verification: "Test",
    }],
  };
  const adapter = new CodexAdapter(async (_command, args) => {
    const schemaIndex = args.indexOf("--output-schema");
    outputSchema = JSON.parse(await readFile(args[schemaIndex + 1], "utf8"));
    const outputIndex = args.indexOf("--output-last-message");
    await writeFile(args[outputIndex + 1], JSON.stringify(strictPayload), "utf8");
    return { exitCode: 0, stdout: "events", stderr: "" };
  }, testEnvironment());
  const result = await adapter.run({ ...request(artifactDir), schema: REVIEW_OUTPUT_SCHEMA });

  assert.equal(outputSchema.properties.phase.type, "string");
  assert.ok(outputSchema.$defs.evidence.required.includes("line"));
  assert.ok(outputSchema.$defs.finding.required.includes("reproduction"));
  assert.deepEqual(outputSchema.$defs.evidence.properties.line.anyOf.at(-1), { type: "null" });
  const normalized = JSON.parse(result.rawOutput);
  assert.deepEqual(normalized.findings[0].evidence[0], {
    path: "src/a.ts",
    observation: "Evidence",
  });
  assert.equal("reproduction" in normalized.findings[0], false);
});

test("Claude adapter limits tools to repository reads", async () => {
  const artifactDir = await mkdtemp(join(tmpdir(), "reviewctl-claude-"));
  let invocation;
  const adapter = new ClaudeAdapter(async (command, args, options) => {
    invocation = { command, args, options };
    return { exitCode: 0, stdout: JSON.stringify({ structured_output: payload }), stderr: "" };
  }, testEnvironment());
  await adapter.run(request(artifactDir));

  assert.equal(invocation.command, "claude");
  assert.deepEqual(pair(invocation.args, "--permission-mode"), ["--permission-mode", "plan"]);
  assert.deepEqual(pair(invocation.args, "--tools"), ["--tools", "Read,Grep,Glob"]);
  assert.ok(invocation.args.includes("--no-session-persistence"));
  assert.equal(invocation.options.stdin, "review prompt");
  assert.equal(invocation.options.env.ANTHROPIC_API_KEY, "anthropic-test-key");
  assert.equal(invocation.options.env.UNRELATED_SECRET, undefined);
});

function request(artifactDir) {
  return {
    runId: "review-test",
    repoPath: artifactDir,
    artifactDir,
    prompt: "review prompt",
    schema,
    timeoutMs: 1_000,
  };
}

function pair(args, flag) {
  const index = args.indexOf(flag);
  return args.slice(index, index + 2);
}

function testEnvironment() {
  return {
    PATH: "/usr/bin",
    HOME: "/tmp/home",
    OPENAI_API_KEY: "openai-test-key",
    ANTHROPIC_API_KEY: "anthropic-test-key",
    UNRELATED_SECRET: "must-not-reach-agent",
    DATABASE_URL: "postgres://private",
  };
}
