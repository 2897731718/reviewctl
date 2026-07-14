import assert from "node:assert/strict";
import { access, mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { resumeReview, runReview, selectJudge, selectReviewers } from "../dist/index.js";

test("runs the complete review pipeline and persists a report", async () => {
  const repoPath = await mkdtemp(join(tmpdir(), "reviewctl-test-"));
  const reviewers = selectReviewers(["codex"]);
  const judge = selectJudge(["codex"]);

  const result = await runReview({
    repoPath,
    scope: "full",
    reviewers,
    judge,
    adapterFactory: () => ({
      provider: "codex",
      async run(request) {
        if (request.prompt.includes("phase=independent_review")) {
          return response({
            phase: "independent_review",
            summary: "Independent review complete.",
            findings: [{
              title: "Missing cancellation cleanup",
              severity: "P1",
              confidence: "high",
              category: "lifecycle",
              evidence: [{ path: "src/runner.ts", line: 10, observation: "No cleanup path." }],
              impact: "Resources can leak.",
              recommendation: "Use a finally block.",
              verification: "Add a cancellation test.",
            }],
          });
        }
        if (request.prompt.includes("phase=cross_challenge")) {
          return response({ phase: "cross_challenge", summary: "Checked.", challenges: [] });
        }
        const ids = [...request.prompt.matchAll(/"id": "([^"]+)"/gu)].map((match) => match[1]);
        return response({
          phase: "adjudication",
          summary: "Two findings remain confirmed. sk-abcdefghijklmnop",
          verdicts: [...new Set(ids)].map((findingId) => ({
            findingId,
            status: "CONFIRMED",
            rationale: "The supplied evidence supports the finding.",
          })),
        });
      },
    }),
  });

  assert.equal(result.snapshot.status, "COMPLETED");
  assert.equal(result.snapshot.findings.length, 2);
  assert.equal(result.snapshot.verdicts.length, 2);
  const report = await readFile(result.reportPath, "utf8");
  assert.match(report, /Adversarial review report/u);
  assert.match(report, /CONFIRMED/u);
  assert.equal(report.includes("sk-abcdefghijklmnop"), false);
  const eventText = await readFile(join(result.reviewDir, "events.ndjson"), "utf8");
  const events = eventText.trim().split("\n");
  assert.ok(events.length >= 10);
  const snapshot = await readFile(join(result.reviewDir, "snapshot.json"), "utf8");
  const rawArtifacts = (await readdir(join(result.reviewDir, "artifacts")))
    .filter((name) => name.endsWith(".raw.txt"));
  const rawText = (await Promise.all(rawArtifacts.map((name) => (
    readFile(join(result.reviewDir, "artifacts", name), "utf8")
  )))).join("\n");
  assert.equal(`${eventText}${snapshot}${rawText}`.includes("sk-abcdefghijklmnop"), false);
});

test("keeps the review locked until every participant settles after a failure", async () => {
  const repoPath = await mkdtemp(join(tmpdir(), "reviewctl-settlement-"));
  const reviewers = selectReviewers(["codex"]);
  const judge = selectJudge(["codex"]);
  let releaseSibling;
  let markSiblingStarted;
  const siblingStarted = new Promise((resolve) => { markSiblingStarted = resolve; });
  const siblingRelease = new Promise((resolve) => { releaseSibling = resolve; });
  const run = runReview({
    repoPath,
    scope: "full",
    reviewers,
    judge,
    adapterFactory: () => ({
      provider: "codex",
      async run(request) {
        if (request.runId.includes("reviewer-1")) throw new Error("reviewer failed");
        markSiblingStarted();
        await siblingRelease;
        return response({ phase: "independent_review", summary: "done", findings: [] });
      },
    }),
  });
  const rejected = assert.rejects(run, /reviewer failed/u);

  await siblingStarted;
  const [reviewId] = await readdir(join(repoPath, ".ai-review", "reviews"));
  await access(join(repoPath, ".ai-review", "reviews", reviewId, "run.lock"));
  await assert.rejects(resumeReview({ repoPath, reviewId }), /already running/u);

  releaseSibling();
  await rejected;
  await assert.rejects(access(join(repoPath, ".ai-review", "reviews", reviewId, "run.lock")));
  const eventText = await readFile(join(repoPath, ".ai-review", "reviews", reviewId, "events.ndjson"), "utf8");
  const events = eventText.trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(events.at(-1).type, "REVIEW_FAILED");
  assert.ok(events.some((event) => event.type === "AGENT_COMPLETED"));
});

function response(payload) {
  const rawOutput = JSON.stringify(payload);
  return { provider: "codex", rawOutput, stdout: rawOutput, stderr: "" };
}
