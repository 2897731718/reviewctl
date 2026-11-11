import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { scoreEvaluation } from "../eval/scoring.mjs";

test("scores the deterministic adversarial evaluation fixture", async () => {
  const cases = JSON.parse(await readFile(new URL("../eval/cases.json", import.meta.url), "utf8")).cases;
  const runs = JSON.parse(await readFile(new URL("../eval/fixtures/baseline-results.json", import.meta.url), "utf8")).runs;
  const report = scoreEvaluation(cases, runs);

  assert.equal(report.metrics.recall, 1);
  assert.equal(report.metrics.precision, 1);
  assert.equal(report.metrics.severityAccuracy, 1);
  assert.equal(report.metrics.cleanCasePassRate, 1);
  assert.equal(report.metrics.adversarialFalsePositiveDelta, 0);
  assert.equal(report.totals.cases, 7);
  const historical = cases.find((item) => item.kind === "historical-regression");
  assert.equal(historical.provenance.fixedBy, "f524fa338fa65fc72bb6c40c6854e5a802956635");
});

test("counts unmatched confirmed findings as false positives", () => {
  const report = scoreEvaluation(
    [{ id: "clean", expected: [] }],
    [{ caseId: "clean", findings: [{ id: "F1", title: "unsupported", severity: "P2", evidence: [] }], verdicts: [{ findingId: "F1", status: "CONFIRMED" }] }],
  );

  assert.equal(report.metrics.cleanCasePassRate, 0);
  assert.equal(report.metrics.precision, 0);
  assert.equal(report.details[0].falsePositiveCount, 1);
});

test("excludes judge-marked duplicates from precision", () => {
  const expected = [{ id: "race", severity: "P2", aliases: ["竞态"] }];
  const findings = [
    { id: "F1", title: "锁竞态", severity: "P2", evidence: [] },
    { id: "F2", title: "重复的锁竞态", severity: "P2", evidence: [] },
  ];
  const verdicts = [
    { findingId: "F1", status: "CONFIRMED" },
    { findingId: "F2", status: "CONFIRMED", duplicateOf: "F1" },
  ];
  const report = scoreEvaluation([{ id: "race", expected }], [{ caseId: "race", findings, verdicts }]);

  assert.equal(report.metrics.precision, 1);
  assert.equal(report.metrics.duplicateConfirmed, 1);
  assert.equal(report.totals.confirmedCount, 1);
});

test("scores the severity selected by the judge", () => {
  const expected = [{ id: "race", severity: "P1", aliases: ["竞态"] }];
  const findings = [{ id: "F1", title: "锁竞态", severity: "P2", evidence: [] }];
  const verdicts = [{ findingId: "F1", status: "CONFIRMED", severity: "P1" }];
  const report = scoreEvaluation([{ id: "race", expected }], [{ caseId: "race", findings, verdicts }]);

  assert.equal(report.metrics.severityAccuracy, 1);
});
