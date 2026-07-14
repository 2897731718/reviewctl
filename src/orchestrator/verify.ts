import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { AdapterFactory } from "../adapters/factory.js";
import { createAdapter } from "../adapters/factory.js";
import { FileLedger } from "../ledger/file-ledger.js";
import { verificationPrompt } from "../prompts/verification-prompt.js";
import { parseStructuredOutput } from "../protocol/parse.js";
import { VERIFICATION_OUTPUT_SCHEMA } from "../protocol/schema.js";
import type {
  Finding,
  ReviewSnapshot,
  Verification,
  VerificationPayload,
} from "../protocol/types.js";
import { renderMarkdownReport } from "../report/markdown.js";
import type { AgentProvider } from "../types.js";
import { redactSensitiveText } from "../security/redact.js";

export interface VerifyInput {
  repoPath: string;
  reviewId: string;
  provider: AgentProvider;
  findingIds?: string[];
  timeoutMs?: number;
  adapterFactory?: AdapterFactory;
}

export interface VerifyResult {
  snapshot: ReviewSnapshot;
  verifications: Verification[];
  reportPath: string;
}

export async function verifyFindings(input: VerifyInput): Promise<VerifyResult> {
  const ledger = await FileLedger.open(input.reviewId, input.repoPath);
  await ledger.acquireLock();
  try {
    const snapshot = JSON.parse(
      await readFile(join(ledger.reviewDir, "snapshot.json"), "utf8"),
    ) as ReviewSnapshot;
    if (snapshot.status !== "COMPLETED") throw new Error(`Review ${input.reviewId} is not completed`);
    const selected = selectFindings(snapshot, input.findingIds);
    const prompt = verificationPrompt(selected);
    const payload = await runVerification({
      ledger,
      provider: input.provider,
      repoPath: input.repoPath,
      prompt,
      timeoutMs: input.timeoutMs ?? 10 * 60_000,
      factory: input.adapterFactory ?? createAdapter,
    });
    const verifiedAt = new Date().toISOString();
    const selectedIds = new Set(selected.map((item) => item.id));
    const returned = new Map(payload.verifications
      .filter((item) => selectedIds.has(item.findingId))
      .map((item) => [item.findingId, item]));
    const verifications: Verification[] = selected.map((finding) => {
      const item = returned.get(finding.id);
      return item
        ? { ...item, provider: input.provider, verifiedAt }
        : {
            findingId: finding.id,
            status: "UNVERIFIED",
            rationale: "The verifier did not return a valid result for this finding.",
            evidence: [],
            provider: input.provider,
            verifiedAt,
          };
    });
    const replaced = new Set(verifications.map((item) => item.findingId));
    snapshot.verifications = [
      ...(snapshot.verifications ?? []).filter((item) => !replaced.has(item.findingId)),
      ...verifications,
    ];
    await ledger.append("FINDINGS_VERIFIED", {
      provider: input.provider,
      summary: payload.summary,
      verifications,
    });
    await ledger.writeSnapshot(snapshot);
    const reportPath = join(ledger.reviewDir, "report.md");
    await writeFile(reportPath, renderMarkdownReport(snapshot), "utf8");
    return { snapshot, verifications, reportPath };
  } catch (error) {
    await ledger.append("VERIFICATION_FAILED", {
      provider: input.provider,
      message: redactSensitiveText(error instanceof Error ? error.message : String(error)),
    });
    throw error;
  } finally {
    await ledger.releaseLock();
  }
}

function selectFindings(snapshot: ReviewSnapshot, requested?: string[]): Finding[] {
  if (requested && requested.length > 0) {
    const byId = new Map(snapshot.findings.map((item) => [item.id, item]));
    return requested.map((id) => {
      const finding = byId.get(id);
      if (!finding) throw new Error(`Finding not found in ${snapshot.reviewId}: ${id}`);
      return finding;
    });
  }
  const confirmed = new Set(snapshot.verdicts
    .filter((item) => item.status === "CONFIRMED")
    .map((item) => item.findingId));
  const selected = snapshot.findings.filter((item) => confirmed.has(item.id));
  if (selected.length === 0) throw new Error("No confirmed findings are available to verify");
  return selected;
}

async function runVerification(input: {
  ledger: FileLedger;
  provider: AgentProvider;
  repoPath: string;
  prompt: string;
  timeoutMs: number;
  factory: AdapterFactory;
}): Promise<VerificationPayload> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const runId = `verification-${input.provider}-attempt-${attempt}`;
    const prompt = attempt === 1
      ? input.prompt
      : `${input.prompt}\n\nYour previous response was invalid. Return only schema-valid structured output.`;
    await input.ledger.writeArtifact(`${runId}.prompt.txt`, prompt);
    await input.ledger.append("AGENT_STARTED", { runId, phase: "verification", attempt });
    const result = await input.factory(input.provider).run({
      runId,
      repoPath: input.repoPath,
      artifactDir: input.ledger.artifactDir,
      prompt,
      schema: VERIFICATION_OUTPUT_SCHEMA,
      timeoutMs: input.timeoutMs,
    });
    const safeRawOutput = redactSensitiveText(result.rawOutput);
    await input.ledger.writeArtifact(`${runId}.raw.txt`, safeRawOutput);
    if (result.stderr) await input.ledger.writeArtifact(`${runId}.stderr.txt`, redactSensitiveText(result.stderr));
    try {
      const payload = parseStructuredOutput<VerificationPayload>(safeRawOutput, "verification");
      await input.ledger.append("AGENT_COMPLETED", { runId, phase: "verification", attempt });
      return payload;
    } catch (error) {
      lastError = error;
      await input.ledger.append("AGENT_OUTPUT_REJECTED", {
        runId,
        attempt,
        message: redactSensitiveText(error instanceof Error ? error.message : String(error)),
      });
    }
  }
  throw lastError;
}
