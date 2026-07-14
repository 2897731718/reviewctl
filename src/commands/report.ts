import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { resolveProjectOutput, resolveRepository } from "../core/repository.js";
import { resolveReviewId } from "../core/review-runs.js";
import type { ReviewSnapshot } from "../protocol/types.js";
import { renderMarkdownReport } from "../report/markdown.js";

export async function runReportCommand(
  args: readonly string[],
  cwd = process.cwd(),
): Promise<string> {
  const { reviewId: requested, output: requestedOutput } = parseArgs(args);
  const repoPath = resolveRepository(cwd);
  const reviewId = await resolveReviewId(repoPath, requested);
  const reviewDir = join(repoPath, ".ai-review", "reviews", reviewId);
  const snapshot = JSON.parse(await readFile(join(reviewDir, "snapshot.json"), "utf8")) as ReviewSnapshot;
  if (snapshot.status !== "COMPLETED") throw new Error(`Review ${reviewId} is not completed; run resume first`);
  const output = requestedOutput
    ? await resolveProjectOutput(repoPath, requestedOutput, "output")
    : join(reviewDir, "report.md");
  await writeFile(output, renderMarkdownReport(snapshot), "utf8");
  return `Report: ${output}`;
}

function parseArgs(args: readonly string[]): { reviewId?: string; output?: string } {
  let reviewId: string | undefined;
  let output: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--output") {
      output = args[index + 1];
      if (!output) throw new Error("Missing value for --output");
      index += 1;
    } else if (!reviewId) {
      reviewId = args[index];
    } else {
      throw new Error(`Unexpected report argument: ${args[index]}`);
    }
  }
  return {
    ...(reviewId ? { reviewId } : {}),
    ...(output ? { output } : {}),
  };
}
