import assert from "node:assert/strict";
import test from "node:test";

import { renderMarkdownReport } from "../dist/report/markdown.js";

test("escapes active content from untrusted model output", () => {
  const report = renderMarkdownReport({
    schemaVersion: "1.0",
    reviewId: "review-test",
    status: "COMPLETED",
    repoPath: "/repo",
    scope: "full",
    participants: [],
    findings: [{
      id: "CODEX-001",
      actorId: "codex-reviewer-1",
      provider: "codex",
      title: "<script>alert(1)</script>",
      severity: "P1",
      confidence: "high",
      category: "security",
      evidence: [{ path: "x.ts", observation: "![track](https://example.invalid/x)" }],
      impact: "unsafe",
      recommendation: "fix",
      verification: "test",
    }],
    challenges: [],
    verdicts: [{ findingId: "CODEX-001", status: "CONFIRMED", rationale: "confirmed" }],
    summary: "done",
    createdAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:01.000Z",
  });

  assert.doesNotMatch(report, /<script>/u);
  assert.doesNotMatch(report, /(?<!\\)!\[track\]/u);
  assert.match(report, /\\!\[track\]/u);
  assert.match(report, /&lt;script&gt;/u);
});
