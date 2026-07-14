import { resolveRepository } from "../core/repository.js";
import { resolveReviewId } from "../core/review-runs.js";
import { FileLedger } from "../ledger/file-ledger.js";
import { verifyFindings } from "../orchestrator/verify.js";
import type { Participant } from "../protocol/types.js";
import type { AgentProvider } from "../types.js";
import { runDoctor } from "./doctor.js";

export async function runVerifyCommand(
  args: readonly string[],
  cwd = process.cwd(),
): Promise<string> {
  const options = parseArgs(args);
  const repoPath = resolveRepository(cwd);
  const reviewId = await resolveReviewId(repoPath, options.reviewId);
  const ready = runDoctor().agents
    .filter((item) => item.available && item.authenticated)
    .map((item) => item.provider);
  if (ready.length === 0) throw new Error("No authenticated provider is available for verification");
  const provider = await selectProvider(repoPath, reviewId, ready, options.provider);
  const result = await verifyFindings({
    repoPath,
    reviewId,
    provider,
    ...(options.findingIds.length > 0 ? { findingIds: options.findingIds } : {}),
  });
  const counts = new Map<string, number>();
  for (const item of result.verifications) counts.set(item.status, (counts.get(item.status) ?? 0) + 1);
  return [
    `Verified review: ${reviewId}`,
    `Provider: ${provider}`,
    `Resolved: ${counts.get("RESOLVED") ?? 0}`,
    `Still present: ${counts.get("STILL_PRESENT") ?? 0}`,
    `Unverified: ${counts.get("UNVERIFIED") ?? 0}`,
    `Report: ${result.reportPath}`,
  ].join("\n");
}

function parseArgs(args: readonly string[]): {
  reviewId?: string;
  provider: "auto" | AgentProvider;
  findingIds: string[];
} {
  let reviewId: string | undefined;
  let provider: "auto" | AgentProvider = "auto";
  const findingIds: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index]!;
    if (value === "--review") {
      reviewId = args[index + 1];
      if (!reviewId) throw new Error("Missing value for --review");
      index += 1;
    } else if (value === "--provider") {
      const candidate = args[index + 1];
      if (candidate !== "auto" && candidate !== "codex" && candidate !== "claude") {
        throw new Error("--provider must be auto, codex, or claude");
      }
      provider = candidate;
      index += 1;
    } else if (value.startsWith("--")) {
      throw new Error(`Unknown verify option: ${value}`);
    } else {
      findingIds.push(value);
    }
  }
  return { provider, findingIds, ...(reviewId ? { reviewId } : {}) };
}

async function selectProvider(
  repoPath: string,
  reviewId: string,
  ready: AgentProvider[],
  requested: "auto" | AgentProvider,
): Promise<AgentProvider> {
  if (requested !== "auto") {
    if (!ready.includes(requested)) throw new Error(`Provider ${requested} is not authenticated`);
    return requested;
  }
  const ledger = await FileLedger.open(reviewId, repoPath);
  const manifest = await ledger.readManifest<{ participants?: Participant[] }>();
  const judge = manifest.participants?.find((item) => item.role === "judge")?.provider;
  return judge && ready.includes(judge) ? judge : ready[0]!;
}
