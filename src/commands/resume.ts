import { resolveRepository } from "../core/repository.js";
import { resolveReviewId } from "../core/review-runs.js";
import { FileLedger } from "../ledger/file-ledger.js";
import { resumeReview } from "../orchestrator/review.js";
import type { Participant } from "../protocol/types.js";
import { runDoctor } from "./doctor.js";

export async function runResumeCommand(
  args: readonly string[],
  cwd = process.cwd(),
): Promise<string> {
  if (args.length > 1) throw new Error("Usage: reviewctl resume [review-id]");
  const repoPath = resolveRepository(cwd);
  const reviewId = await resolveReviewId(repoPath, args[0]);
  const ledger = await FileLedger.open(reviewId, repoPath);
  const manifest = await ledger.readManifest<{ participants?: Participant[] }>();
  const required = new Set(manifest.participants?.map((item) => item.provider) ?? []);
  const ready = new Set(runDoctor().agents
    .filter((item) => item.available && item.authenticated)
    .map((item) => item.provider));
  for (const provider of required) {
    if (!ready.has(provider)) throw new Error(`Cannot resume: provider ${provider} is not authenticated`);
  }
  const result = await resumeReview({ repoPath, reviewId });
  return [
    `Review completed: ${result.snapshot.reviewId}`,
    `Findings: ${result.snapshot.findings.length}`,
    `Report: ${result.reportPath}`,
  ].join("\n");
}
