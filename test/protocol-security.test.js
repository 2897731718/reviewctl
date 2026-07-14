import assert from "node:assert/strict";
import test from "node:test";

import { parseStructuredOutput } from "../dist/protocol/parse.js";
import { buildAgentEnvironment } from "../dist/security/environment.js";
import { redactSensitiveText } from "../dist/security/redact.js";

test("agent environments use provider-specific allowlists", () => {
  const source = {
    PATH: "/usr/bin",
    OPENAI_API_KEY: "openai-test-key",
    ANTHROPIC_API_KEY: "anthropic-test-key",
    DATABASE_URL: "postgres://private",
    GITHUB_TOKEN: "github-private-token",
  };

  assert.deepEqual(buildAgentEnvironment("codex", source), {
    PATH: "/usr/bin",
    OPENAI_API_KEY: "openai-test-key",
  });
  assert.deepEqual(buildAgentEnvironment("claude", source), {
    PATH: "/usr/bin",
    ANTHROPIC_API_KEY: "anthropic-test-key",
  });
});

test("redaction removes known environment secrets and common token shapes", () => {
  const text = "token=private-sentinel-value api=sk-abcdefghijklmnop auth=Bearer abcdefghijklmnop";
  const redacted = redactSensitiveText(text, { REVIEW_TOKEN: "private-sentinel-value" });

  assert.equal(redacted.includes("private-sentinel-value"), false);
  assert.equal(redacted.includes("sk-abcdefghijklmnop"), false);
  assert.equal(redacted.includes("abcdefghijklmnop"), false);
  assert.match(redacted, /\[REDACTED\]/u);

  const escaped = redactSensitiveText(
    JSON.stringify({ token: "private-\"sentinel" }),
    { REVIEW_TOKEN: "private-\"sentinel" },
  );
  assert.deepEqual(JSON.parse(escaped), { token: "[REDACTED]" });
});

test("structured output is rejected when nested fields violate the schema", () => {
  const invalid = JSON.stringify({
    phase: "independent_review",
    summary: "bad severity",
    findings: [{
      title: "Issue",
      severity: "critical",
      confidence: "high",
      category: "security",
      evidence: [{ path: "src/index.ts", observation: "Observed" }],
      impact: "Impact",
      recommendation: "Fix it",
      verification: "Test it",
    }],
  });

  assert.throws(
    () => parseStructuredOutput(invalid, "independent_review"),
    /schema validation/u,
  );
});

test("structured output accepts a provider wrapper when the payload is valid", () => {
  const wrapped = JSON.stringify({
    structured_output: {
      phase: "independent_review",
      summary: "ok",
      findings: [],
    },
  });

  assert.equal(parseStructuredOutput(wrapped, "independent_review").summary, "ok");
});
