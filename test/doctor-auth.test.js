import assert from "node:assert/strict";
import test from "node:test";

import { detectAuthentication } from "../dist/index.js";
import { buildAgentEnvironment } from "../dist/security/environment.js";

const notLoggedIn = () => ({ status: 1, stdout: "Not logged in\n", stderr: "" });

test("detects an environment-only Codex API key without exposing its value", () => {
  const secret = "test-secret-that-must-not-appear";
  const health = detectAuthentication("codex", {
    env: { OPENAI_API_KEY: secret },
    runner: notLoggedIn,
  });
  assert.equal(health.authenticated, true);
  assert.equal(health.credentialSource, "OPENAI_API_KEY");
  assert.match(health.authDetail ?? "", /not validated/u);
  assert.doesNotMatch(JSON.stringify(health), new RegExp(secret, "u"));
});

test("detects Claude API key and auth token environment sources", () => {
  const loggedOutStatus = () => ({
    status: 0,
    stdout: JSON.stringify({ loggedIn: false, authMethod: "none" }),
    stderr: "",
  });
  const apiKey = detectAuthentication("claude", {
    env: { ANTHROPIC_API_KEY: "secret" },
    runner: loggedOutStatus,
  });
  const authToken = detectAuthentication("claude", {
    env: { ANTHROPIC_AUTH_TOKEN: "secret" },
    runner: loggedOutStatus,
  });
  assert.equal(apiKey.authenticated, true);
  assert.equal(authToken.authenticated, true);
  assert.equal(apiKey.credentialSource, "ANTHROPIC_API_KEY");
  assert.equal(authToken.credentialSource, "ANTHROPIC_AUTH_TOKEN");
});

test("passes ccapi credentials and model settings only to Claude", () => {
  const source = {
    PATH: "/usr/bin",
    ANTHROPIC_AUTH_TOKEN: "test-token",
    ANTHROPIC_BASE_URL: "https://proxy.example.test",
    ANTHROPIC_MODEL: "claude-test-model",
    UNRELATED_SECRET: "must-not-pass",
  };
  const claudeEnvironment = buildAgentEnvironment("claude", source);
  const codexEnvironment = buildAgentEnvironment("codex", source);

  assert.deepEqual(claudeEnvironment, {
    PATH: "/usr/bin",
    ANTHROPIC_AUTH_TOKEN: "test-token",
    ANTHROPIC_BASE_URL: "https://proxy.example.test",
    ANTHROPIC_MODEL: "claude-test-model",
  });
  assert.deepEqual(codexEnvironment, { PATH: "/usr/bin" });
});

test("does not treat an empty environment variable as a credential", () => {
  const health = detectAuthentication("codex", {
    env: { OPENAI_API_KEY: "   " },
    runner: notLoggedIn,
  });
  assert.equal(health.authenticated, false);
});
