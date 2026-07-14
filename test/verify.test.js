import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runReview, selectJudge, selectReviewers, verifyFindings } from "../dist/index.js";

test("verification preserves verdict history and records current resolution state", async () => {
  const repoPath = await mkdtemp(join(tmpdir(), "reviewctl-verify-"));
  const adapterFactory = () => ({
    provider: "codex",
    async run(request) {
      let payload;
      if (request.prompt.includes("phase=independent_review")) {
        payload = {
          phase: "independent_review", summary: "reviewed",
          findings: [{
            title: "Leak", severity: "P1", confidence: "high", category: "lifecycle",
            evidence: [{ path: "runner.ts", observation: "Cleanup missing" }], impact: "Leak",
            recommendation: "Cleanup", verification: "Inspect cleanup",
          }],
        };
      } else if (request.prompt.includes("phase=cross_challenge")) {
        payload = { phase: "cross_challenge", summary: "checked", challenges: [] };
      } else if (request.prompt.includes("phase=verification")) {
        const ids = [...request.prompt.matchAll(/"id": "([^"]+)"/gu)].map((match) => match[1]);
        payload = {
          phase: "verification", summary: "fixed",
          verifications: [...new Set(ids)].map((findingId) => ({
            findingId, status: "RESOLVED", rationale: "Cleanup now exists.",
            evidence: [{ path: "runner.ts", observation: "A finally block cleans up." }],
          })),
        };
      } else {
        const ids = [...request.prompt.matchAll(/"id": "([^"]+)"/gu)].map((match) => match[1]);
        payload = {
          phase: "adjudication", summary: "confirmed",
          verdicts: [...new Set(ids)].map((findingId) => ({
            findingId, status: "CONFIRMED", rationale: "Confirmed.",
          })),
        };
      }
      const rawOutput = JSON.stringify(payload);
      return { provider: "codex", rawOutput, stdout: rawOutput, stderr: "" };
    },
  });
  const review = await runReview({
    repoPath,
    scope: "full",
    reviewers: selectReviewers(["codex"]),
    judge: selectJudge(["codex"]),
    adapterFactory,
  });
  const result = await verifyFindings({
    repoPath,
    reviewId: review.snapshot.reviewId,
    provider: "codex",
    adapterFactory,
  });

  assert.ok(result.snapshot.verdicts.every((item) => item.status === "CONFIRMED"));
  assert.ok(result.verifications.every((item) => item.status === "RESOLVED"));
  assert.equal(result.snapshot.verifications?.length, 2);
  const report = await readFile(result.reportPath, "utf8");
  assert.match(report, /Latest verification: \*\*RESOLVED\*\*/u);
  assert.match(report, /A finally block cleans up/u);
});
