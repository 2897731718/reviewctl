import assert from "node:assert/strict";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { resumeReview, runReview, selectJudge, selectReviewers } from "../dist/index.js";

test("resume skips completed review and challenge phases", async () => {
  const repoPath = await mkdtemp(join(tmpdir(), "reviewctl-resume-"));
  const reviewers = selectReviewers(["codex"]);
  const judge = selectJudge(["codex"]);
  let firstRunCalls = 0;
  await assert.rejects(runReview({
    repoPath,
    scope: "full",
    reviewers,
    judge,
    adapterFactory: () => fakeAdapter(() => {
      firstRunCalls += 1;
      if (firstRunCalls === 5) throw new Error("judge interrupted");
    }),
  }), /judge interrupted/u);
  assert.equal(firstRunCalls, 5);

  const [reviewId] = await readdir(join(repoPath, ".ai-review", "reviews"));
  let resumeCalls = 0;
  const result = await resumeReview({
    repoPath,
    reviewId,
    adapterFactory: () => fakeAdapter(() => { resumeCalls += 1; }),
  });
  assert.equal(resumeCalls, 1);
  assert.equal(result.snapshot.status, "COMPLETED");
  assert.equal(result.snapshot.findings.length, 2);
});

function fakeAdapter(beforeRun) {
  return {
    provider: "codex",
    async run(request) {
      beforeRun();
      let payload;
      if (request.prompt.includes("phase=independent_review")) {
        payload = {
          phase: "independent_review", summary: "reviewed",
          findings: [{
            title: "Issue", severity: "P1", confidence: "high", category: "test",
            evidence: [{ path: "x.ts", observation: "Evidence" }], impact: "Impact",
            recommendation: "Fix", verification: "Test",
          }],
        };
      } else if (request.prompt.includes("phase=cross_challenge")) {
        payload = { phase: "cross_challenge", summary: "challenged", challenges: [] };
      } else {
        const ids = [...request.prompt.matchAll(/"id": "([^"]+)"/gu)].map((match) => match[1]);
        payload = {
          phase: "adjudication", summary: "done",
          verdicts: [...new Set(ids)].map((findingId) => ({
            findingId, status: "CONFIRMED", rationale: "Evidence supports it.",
          })),
        };
      }
      const rawOutput = JSON.stringify(payload);
      return { provider: "codex", rawOutput, stdout: rawOutput, stderr: "" };
    },
  };
}
