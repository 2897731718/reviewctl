import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { AdapterFactory } from "../adapters/factory.js";
import { createAdapter } from "../adapters/factory.js";
import { FileLedger, createReviewId } from "../ledger/file-ledger.js";
import { adjudicationPrompt, challengePrompt, independentReviewPrompt } from "../prompts/review-prompts.js";
import { parseStructuredOutput } from "../protocol/parse.js";
import { CHALLENGE_OUTPUT_SCHEMA, REVIEW_OUTPUT_SCHEMA, VERDICT_OUTPUT_SCHEMA } from "../protocol/schema.js";
import type {
  Challenge, ChallengePayload, Finding, Participant, ReviewPayload, ReviewScope,
  ReviewSnapshot, Verdict, VerdictPayload,
} from "../protocol/types.js";
import { renderMarkdownReport } from "../report/markdown.js";
import { redactSensitiveText } from "../security/redact.js";

export interface RunReviewInput {
  repoPath: string;
  scope: ReviewScope;
  base?: string;
  spec?: string;
  reviewers: Participant[];
  judge: Participant;
  timeoutMs?: number;
  adapterFactory?: AdapterFactory;
}

interface ReviewManifest {
  schemaVersion: "1.0";
  reviewId: string;
  createdAt: string;
  repoPath: string;
  scope: ReviewScope;
  base?: string;
  spec?: string;
  participants: Participant[];
}

export interface RunReviewResult {
  snapshot: ReviewSnapshot;
  reviewDir: string;
  reportPath: string;
}

export async function runReview(input: RunReviewInput): Promise<RunReviewResult> {
  const reviewId = createReviewId();
  const createdAt = new Date().toISOString();
  const participants = [...input.reviewers, input.judge];
  const manifest: ReviewManifest = {
    schemaVersion: "1.0", reviewId, createdAt, repoPath: input.repoPath, scope: input.scope,
    ...(input.base ? { base: input.base } : {}),
    ...(input.spec ? { spec: input.spec } : {}),
    participants,
  };
  const ledger = await FileLedger.create(reviewId, input.repoPath, manifest);
  return executeReview(input, manifest, ledger);
}

export async function resumeReview(input: {
  repoPath: string;
  reviewId: string;
  timeoutMs?: number;
  adapterFactory?: AdapterFactory;
}): Promise<RunReviewResult> {
  const ledger = await FileLedger.open(input.reviewId, input.repoPath);
  const manifest = await ledger.readManifest<ReviewManifest>();
  if (manifest.repoPath !== input.repoPath) throw new Error("Review manifest repository does not match cwd");
  const reviewers = manifest.participants.filter((item) => item.role === "reviewer");
  const judge = manifest.participants.find((item) => item.role === "judge");
  if (!judge || reviewers.length < 2) throw new Error("Review manifest has invalid participants");
  return executeReview({
    repoPath: input.repoPath,
    scope: manifest.scope,
    reviewers,
    judge,
    ...(manifest.base ? { base: manifest.base } : {}),
    ...(manifest.spec ? { spec: manifest.spec } : {}),
    ...(input.timeoutMs ? { timeoutMs: input.timeoutMs } : {}),
    ...(input.adapterFactory ? { adapterFactory: input.adapterFactory } : {}),
  }, manifest, ledger);
}

async function executeReview(
  input: RunReviewInput,
  manifest: ReviewManifest,
  ledger: FileLedger,
): Promise<RunReviewResult> {
  await ledger.acquireLock();
  const timeoutMs = input.timeoutMs ?? 10 * 60_000;
  const factory = input.adapterFactory ?? createAdapter;
  let findings: Finding[] = [];
  let challenges: Challenge[] = [];
  try {
    const events = await ledger.readEvents();
    const completed = await readCompletedSnapshot(ledger);
    if (completed) return resultFromSnapshot(ledger, completed);
    const findingEvent = [...events].reverse().find((event) => event.type === "INDEPENDENT_REVIEW_COMPLETED");
    if (findingEvent) findings = eventArray<Finding>(findingEvent.data, "findings");
    const challengeEvent = [...events].reverse().find((event) => event.type === "CROSS_CHALLENGE_COMPLETED");
    if (challengeEvent) challenges = eventArray<Challenge>(challengeEvent.data, "challenges");

    await ledger.append(events.length === 0 ? "REVIEW_STARTED" : "REVIEW_RESUMED", {
      participants: manifest.participants,
    });
    if (!findingEvent) {
      const results = await settleAll(input.reviewers.map(async (participant) => ({
        participant,
        payload: await runParticipant<ReviewPayload>({
          participant, phase: "independent_review",
          prompt: independentReviewPrompt({
            participant, scope: input.scope,
            ...(input.base ? { base: input.base } : {}),
            ...(input.spec ? { spec: input.spec } : {}),
          }),
          schema: REVIEW_OUTPUT_SCHEMA, ledger, factory, timeoutMs, repoPath: input.repoPath,
        }),
      })));
      findings = results.flatMap(({ participant, payload }) => payload.findings.map((finding, index) => ({
        ...finding,
        id: `${participant.provider.toUpperCase()}-R${participant.actorId.split("-").at(-1) ?? "1"}-${String(index + 1).padStart(3, "0")}`,
        actorId: participant.actorId,
        provider: participant.provider,
      })));
      await ledger.append("INDEPENDENT_REVIEW_COMPLETED", { findings });
    }

    if (!challengeEvent) {
      const results = await settleAll(input.reviewers.map(async (participant) => ({
        participant,
        payload: await runParticipant<ChallengePayload>({
          participant, phase: "cross_challenge",
          prompt: challengePrompt({ participant, findings: findings.filter((item) => item.actorId !== participant.actorId) }),
          schema: CHALLENGE_OUTPUT_SCHEMA, ledger, factory, timeoutMs, repoPath: input.repoPath,
        }),
      })));
      const findingIds = new Set(findings.map((item) => item.id));
      challenges = results.flatMap(({ participant, payload }) => payload.challenges
        .filter((item) => findingIds.has(item.targetId))
        .map((item) => ({ ...item, actorId: participant.actorId, provider: participant.provider })));
      await ledger.append("CROSS_CHALLENGE_COMPLETED", { challenges });
    }

    const adjudication = await runParticipant<VerdictPayload>({
      participant: input.judge, phase: "adjudication",
      prompt: adjudicationPrompt({ judge: input.judge, findings, challenges }),
      schema: VERDICT_OUTPUT_SCHEMA, ledger, factory, timeoutMs, repoPath: input.repoPath,
    });
    const snapshot: ReviewSnapshot = {
      schemaVersion: "1.0", reviewId: manifest.reviewId, status: "COMPLETED",
      repoPath: input.repoPath, scope: input.scope,
      ...(input.base ? { base: input.base } : {}), ...(input.spec ? { spec: input.spec } : {}),
      participants: manifest.participants, findings, challenges,
      verdicts: normalizeVerdicts(findings, adjudication.verdicts), summary: adjudication.summary,
      createdAt: manifest.createdAt, completedAt: new Date().toISOString(),
    };
    await ledger.append("REVIEW_COMPLETED", { summary: snapshot.summary, verdicts: snapshot.verdicts });
    await ledger.writeSnapshot(snapshot);
    return writeReport(ledger, snapshot);
  } catch (error) {
    const message = redactSensitiveText(error instanceof Error ? error.message : String(error));
    await ledger.append("REVIEW_FAILED", { message });
    await ledger.writeSnapshot({
      schemaVersion: "1.0", reviewId: manifest.reviewId, status: "FAILED",
      repoPath: input.repoPath, scope: input.scope, participants: manifest.participants,
      findings, challenges, error: message, createdAt: manifest.createdAt,
      failedAt: new Date().toISOString(),
    });
    throw error;
  } finally {
    await ledger.releaseLock();
  }
}

async function runParticipant<T>(input: {
  participant: Participant;
  phase: "independent_review" | "cross_challenge" | "adjudication";
  prompt: string;
  schema: object;
  ledger: FileLedger;
  factory: AdapterFactory;
  timeoutMs: number;
  repoPath: string;
}): Promise<T> {
  let parseError: unknown;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const runId = `${input.phase}-${input.participant.actorId}-attempt-${attempt}`;
    const prompt = attempt === 1 ? input.prompt : `${input.prompt}\n\nYour previous response was invalid. Return only schema-valid structured output.`;
    await input.ledger.writeArtifact(`${runId}.prompt.txt`, prompt);
    await input.ledger.append("AGENT_STARTED", { runId, phase: input.phase, participant: input.participant, attempt });
    const result = await input.factory(input.participant.provider).run({
      runId, repoPath: input.repoPath, artifactDir: input.ledger.artifactDir,
      prompt, schema: input.schema, timeoutMs: input.timeoutMs,
    });
    const safeRawOutput = redactSensitiveText(result.rawOutput);
    await input.ledger.writeArtifact(`${runId}.raw.txt`, safeRawOutput);
    if (result.stderr) await input.ledger.writeArtifact(`${runId}.stderr.txt`, redactSensitiveText(result.stderr));
    try {
      const payload = parseStructuredOutput<T>(safeRawOutput, input.phase);
      await input.ledger.append("AGENT_COMPLETED", { runId, phase: input.phase, attempt });
      return payload;
    } catch (error) {
      parseError = error;
      await input.ledger.append("AGENT_OUTPUT_REJECTED", {
        runId, attempt, message: redactSensitiveText(error instanceof Error ? error.message : String(error)),
      });
    }
  }
  throw parseError;
}

async function readCompletedSnapshot(ledger: FileLedger): Promise<ReviewSnapshot | undefined> {
  try {
    const value = JSON.parse(await readFile(join(ledger.reviewDir, "snapshot.json"), "utf8")) as ReviewSnapshot;
    return value.status === "COMPLETED" ? value : undefined;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

async function writeReport(ledger: FileLedger, snapshot: ReviewSnapshot): Promise<RunReviewResult> {
  const reportPath = join(ledger.reviewDir, "report.md");
  await writeFile(reportPath, renderMarkdownReport(snapshot), "utf8");
  return { snapshot, reviewDir: ledger.reviewDir, reportPath };
}

function resultFromSnapshot(ledger: FileLedger, snapshot: ReviewSnapshot): RunReviewResult {
  return { snapshot, reviewDir: ledger.reviewDir, reportPath: join(ledger.reviewDir, "report.md") };
}

function eventArray<T>(data: unknown, key: string): T[] {
  if (typeof data !== "object" || data === null || !(key in data)) return [];
  const value = (data as Record<string, unknown>)[key];
  return Array.isArray(value) ? value as T[] : [];
}

function normalizeVerdicts(findings: Finding[], supplied: Verdict[]): Verdict[] {
  const ids = new Set(findings.map((item) => item.id));
  const byId = new Map<string, Verdict>();
  for (const verdict of supplied) if (ids.has(verdict.findingId) && !byId.has(verdict.findingId)) byId.set(verdict.findingId, verdict);
  return findings.map((finding) => byId.get(finding.id) ?? ({
    findingId: finding.id, status: "UNVERIFIED", rationale: "No valid verdict was returned for this finding.",
  }));
}

async function settleAll<T>(operations: Promise<T>[]): Promise<T[]> {
  const results = await Promise.allSettled(operations);
  const rejected = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (rejected) throw rejected.reason;
  return results.map((result) => (result as PromiseFulfilledResult<T>).value);
}
