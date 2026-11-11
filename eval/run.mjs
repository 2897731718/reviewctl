import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { scoreEvaluation } from "./scoring.mjs";

const evalDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(evalDir, "..");
const args = process.argv.slice(2);
const cases = JSON.parse(await readFile(join(evalDir, "cases.json"), "utf8")).cases;
const selectedId = valueAfter("--case");
const selectedCases = selectedId ? cases.filter((item) => item.id === selectedId) : cases;
if (selectedCases.length === 0) throw new Error(`Unknown evaluation case: ${selectedId}`);
const repeatCount = positiveInteger(valueAfter("--repeat") ?? "1", "--repeat");
if (repeatCount > 20) throw new Error("--repeat must be at most 20");

let runs;
let failures = [];
const startedAt = new Date().toISOString();
if (args.includes("--live")) {
  if (!args.includes("--confirm-cost")) {
    throw new Error("Live evaluation makes real model calls. Re-run with --confirm-cost.");
  }
  runs = [];
  for (let repeat = 1; repeat <= repeatCount; repeat += 1) {
    for (const evaluationCase of selectedCases) {
      try {
        runs.push({ ...(await runLiveCase(evaluationCase)), repeat });
      } catch (error) {
        const failure = {
          caseId: evaluationCase.id,
          repeat,
          error: error instanceof Error ? error.message : String(error),
          ...(typeof error === "object" && error !== null && "caseRoot" in error
            ? { caseRoot: String(error.caseRoot) }
            : {}),
        };
        failures.push(failure);
        console.error(`failed ${evaluationCase.id} repeat ${repeat}: ${failure.error}`);
      }
    }
  }
} else {
  const resultsPath = valueAfter("--results");
  if (!resultsPath) throw new Error("Provide --results <path> or use --live --confirm-cost.");
  runs = JSON.parse(await readFile(resolve(repoRoot, resultsPath), "utf8")).runs
    .map((run) => ({ ...run, repeat: run.repeat ?? 1 }));
}

const repeatReports = Array.from({ length: repeatCount }, (_, index) => {
  const repeat = index + 1;
  const repeatRuns = runs.filter((run) => run.repeat === repeat);
  const successfulIds = new Set(repeatRuns.map((run) => run.caseId));
  const successfulCases = selectedCases.filter((item) => successfulIds.has(item.id));
  return {
    repeat,
    score: successfulCases.length ? scoreEvaluation(successfulCases, repeatRuns) : null,
  };
});
const report = {
  schemaVersion: "1.0",
  mode: args.includes("--live") ? "live" : "fixture",
  startedAt,
  completedAt: new Date().toISOString(),
  repeatCount,
  selectedCases: selectedCases.map((item) => item.id),
  successfulRuns: runs.length,
  failures,
  stability: stabilitySummary(selectedCases, repeatReports),
  repeats: repeatReports,
  runs,
};
console.log(JSON.stringify(report, null, 2));
if (args.includes("--live")) {
  const outputPath = resolveOutputPath(valueAfter("--output"));
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.error(`saved evaluation result: ${outputPath}`);
}

async function runLiveCase(evaluationCase) {
  const caseRoot = await mkdtemp(join(tmpdir(), `reviewctl-eval-${evaluationCase.id}-`));
  try {
    for (const [relativePath, content] of Object.entries(evaluationCase.files)) {
      const target = join(caseRoot, relativePath);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content, "utf8");
    }
    await writeFile(join(caseRoot, "package.json"), JSON.stringify({ name: evaluationCase.id, type: "module", private: true }, null, 2), "utf8");
    run("git", ["init", "--quiet"], caseRoot);
    run("git", ["config", "user.email", "reviewctl-eval@example.invalid"], caseRoot);
    run("git", ["config", "user.name", "reviewctl eval"], caseRoot);
    run("git", ["add", "."], caseRoot);
    run("git", ["commit", "--quiet", "-m", "evaluation fixture"], caseRoot);
    run(process.execPath, [join(repoRoot, "dist/cli.js"), "review", "--scope", "implementation", "--base", "HEAD", "--output", "eval-report.md"], caseRoot);
    const reviewsRoot = join(caseRoot, ".ai-review", "reviews");
    const reviewIds = await readdir(reviewsRoot);
    const reviewStats = await Promise.all(reviewIds.map(async (reviewId) => ({
      reviewId,
      modifiedAt: (await stat(join(reviewsRoot, reviewId))).mtimeMs,
    })));
    const reviewId = reviewStats.sort((left, right) => right.modifiedAt - left.modifiedAt)[0]?.reviewId;
    if (!reviewId) throw new Error(`No review output found for ${evaluationCase.id}`);
    const snapshot = JSON.parse(await readFile(join(reviewsRoot, reviewId, "snapshot.json"), "utf8"));
    console.error(`completed ${evaluationCase.id}: ${caseRoot}`);
    return { caseId: evaluationCase.id, findings: snapshot.findings, verdicts: snapshot.verdicts, caseRoot };
  } catch (error) {
    const wrapped = new Error(error instanceof Error ? error.message : String(error));
    wrapped.caseRoot = caseRoot;
    throw wrapped;
  }
}

function run(command, commandArgs, cwd) {
  try {
    const output = execFileSync(command, commandArgs, {
      cwd,
      encoding: "utf8",
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (output) process.stdout.write(output);
  } catch (error) {
    const stderr = typeof error === "object" && error !== null && "stderr" in error
      ? String(error.stderr ?? "").trim()
      : "";
    const stdout = typeof error === "object" && error !== null && "stdout" in error
      ? String(error.stdout ?? "").trim()
      : "";
    throw new Error(stderr || stdout || (error instanceof Error ? error.message : String(error)));
  }
}

function valueAfter(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function positiveInteger(value, flag) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${flag} must be a positive integer`);
  return parsed;
}

function resolveOutputPath(requested) {
  if (requested) return resolve(repoRoot, requested);
  const timestamp = new Date().toISOString().replaceAll(":", "-");
  return join(evalDir, "results", `${timestamp}.json`);
}

function stabilitySummary(evaluationCases, reports) {
  if (reports.length < 2) return { eligibleCases: 0, stableCases: 0, stabilityRate: null };
  const signaturesByCase = new Map(evaluationCases.map((item) => [item.id, []]));
  for (const report of reports) {
    for (const detail of report.score?.details ?? []) {
      signaturesByCase.get(detail.caseId)?.push(JSON.stringify({
        detectedCount: detail.detectedCount,
        confirmedCount: detail.confirmedCount,
        severityCorrectCount: detail.severityCorrectCount,
        falsePositiveCount: detail.falsePositiveCount,
      }));
    }
  }
  const eligible = [...signaturesByCase.values()].filter((signatures) => signatures.length === reports.length);
  const stable = eligible.filter((signatures) => new Set(signatures).size === 1);
  return {
    eligibleCases: eligible.length,
    stableCases: stable.length,
    stabilityRate: eligible.length ? Number((stable.length / eligible.length).toFixed(4)) : null,
  };
}
