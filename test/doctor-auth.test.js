import assert from "node:assert/strict";
import test from "node:test";

import { detectAuthentication } from "../dist/index.js";

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
  const invalidStatus = () => ({ status: 0, stdout: "not-json", stderr: "" });
  const apiKey = detectAuthentication("claude", {
    env: { ANTHROPIC_API_KEY: "secret" },
    runner: invalidStatus,
  });
  const authToken = detectAuthentication("claude", {
    env: { ANTHROPIC_AUTH_TOKEN: "secret" },
    runner: invalidStatus,
  });
  assert.equal(apiKey.credentialSource, "ANTHROPIC_API_KEY");
  assert.equal(authToken.credentialSource, "ANTHROPIC_AUTH_TOKEN");
});

test("does not treat an empty environment variable as a credential", () => {
  const health = detectAuthentication("codex", {
    env: { OPENAI_API_KEY: "   " },
    runner: notLoggedIn,
  });
  assert.equal(health.authenticated, false);
});
