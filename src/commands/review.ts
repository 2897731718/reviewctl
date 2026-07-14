import { copyFile } from "node:fs/promises";
import { relative } from "node:path";

import { resolveProjectFile, resolveProjectOutput, resolveRepository } from "../core/repository.js";
import { runReview } from "../orchestrator/review.js";
import { selectJudge, selectReviewers } from "../orchestrator/select-participants.js";
import type { ReviewScope } from "../protocol/types.js";
import type { AgentProvider } from "../types.js";
import { runDoctor } from "./doctor.js";

interface ReviewCliOptions {
  scope: ReviewScope;
  base?: string;
  spec?: string;
  reviewers: string;
  judge: string;
  output?: string;
  timeoutMs: number;
}

export function reviewHelp(): string {
  return `Usage:
  reviewctl review [options]

Options:
  --scope <architecture|implementation|full>  Review scope (default: full)
  --spec <path>                               Specification inside the repository
  --base <ref>                                Comparison base metadata
  --reviewers <auto|provider[:count],...>     Reviewer sessions (default: auto)
  --judge <auto|codex|claude>                 Judge provider (default: auto)
  --output <path>                             Copy the Markdown report inside the repository
  --timeout-minutes <number>                  Timeout per agent call (default: 10)
  -h, --help                                  Show this help`;
}

export async function runReviewCommand(
  args: readonly string[],
  cwd = process.cwd(),
): Promise<string> {
  const options = parseReviewOptions(args);
  const repoPath = resolveRepository(cwd);
  const spec = options.spec ? await resolveProjectFile(repoPath, options.spec, "spec") : undefined;
  const output = options.output
    ? await resolveProjectOutput(repoPath, options.output, "output")
    : undefined;
  const health = runDoctor();
  const providers = health.agents
    .filter((agent) => agent.available && agent.authenticated)
    .map((agent) => agent.provider) as AgentProvider[];
  const reviewers = selectReviewers(providers, options.reviewers);
  const judge = selectJudge(providers, options.judge);
  const result = await runReview({
    repoPath,
    scope: options.scope,
    reviewers,
    judge,
    timeoutMs: options.timeoutMs,
    ...(options.base ? { base: options.base } : {}),
    ...(spec ? { spec: relative(repoPath, spec) } : {}),
  });
  let reportPath = result.reportPath;
  if (output) {
    await copyFile(result.reportPath, output);
    reportPath = output;
  }

  return [
    `Review completed: ${result.snapshot.reviewId}`,
    `Findings: ${result.snapshot.findings.length}`,
    `Confirmed: ${result.snapshot.verdicts.filter((item) => item.status === "CONFIRMED").length}`,
    `Ledger: ${result.reviewDir}`,
    `Report: ${reportPath}`,
  ].join("\n");
}

function parseReviewOptions(args: readonly string[]): ReviewCliOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index]!;
    if (!flag.startsWith("--")) throw new Error(`Unexpected review argument: ${flag}`);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
    values.set(flag, value);
    index += 1;
  }
  const allowed = new Set([
    "--scope", "--spec", "--base", "--reviewers", "--judge", "--output", "--timeout-minutes",
  ]);
  for (const flag of values.keys()) {
    if (!allowed.has(flag)) throw new Error(`Unknown review option: ${flag}`);
  }
  const scope = values.get("--scope") ?? "full";
  if (scope !== "architecture" && scope !== "implementation" && scope !== "full") {
    throw new Error(`Invalid review scope: ${scope}`);
  }
  const timeoutMinutes = Number(values.get("--timeout-minutes") ?? "10");
  if (!Number.isFinite(timeoutMinutes) || timeoutMinutes <= 0 || timeoutMinutes > 60) {
    throw new Error("--timeout-minutes must be greater than 0 and at most 60");
  }
  return {
    scope,
    reviewers: values.get("--reviewers") ?? "auto",
    judge: values.get("--judge") ?? "auto",
    timeoutMs: timeoutMinutes * 60_000,
    ...(values.has("--base") ? { base: values.get("--base")! } : {}),
    ...(values.has("--spec") ? { spec: values.get("--spec")! } : {}),
    ...(values.has("--output") ? { output: values.get("--output")! } : {}),
  };
}
