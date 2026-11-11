const CONFIRMED = "CONFIRMED";

export function scoreEvaluation(cases, runs) {
  const runByCase = new Map(runs.map((run) => [run.caseId, run]));
  const details = cases.map((evaluationCase) => scoreCase(evaluationCase, runByCase.get(evaluationCase.id)));
  const expectedCount = details.reduce((sum, item) => sum + item.expectedCount, 0);
  const detectedCount = details.reduce((sum, item) => sum + item.detectedCount, 0);
  const confirmedCount = details.reduce((sum, item) => sum + item.confirmedCount, 0);
  const truePositiveCount = details.reduce((sum, item) => sum + item.truePositiveCount, 0);
  const severityCorrectCount = details.reduce((sum, item) => sum + item.severityCorrectCount, 0);
  const cleanCases = details.filter((item) => item.expectedCount === 0);
  const rawFalsePositives = details.reduce((sum, item) => sum + item.rawFalsePositiveCount, 0);
  const finalFalsePositives = details.reduce((sum, item) => sum + item.falsePositiveCount, 0);
  const duplicateConfirmed = details.reduce((sum, item) => sum + item.duplicateConfirmedCount, 0);

  return {
    metrics: {
      recall: ratio(detectedCount, expectedCount),
      precision: ratio(truePositiveCount, confirmedCount),
      severityAccuracy: ratio(severityCorrectCount, detectedCount),
      cleanCasePassRate: ratio(cleanCases.filter((item) => item.falsePositiveCount === 0).length, cleanCases.length),
      rawFalsePositives,
      finalFalsePositives,
      duplicateConfirmed,
      adversarialFalsePositiveDelta: finalFalsePositives - rawFalsePositives,
    },
    totals: { cases: details.length, expectedCount, detectedCount, confirmedCount, truePositiveCount },
    details,
  };
}

function scoreCase(evaluationCase, run) {
  const findings = run?.findings ?? [];
  const verdictById = new Map((run?.verdicts ?? []).map((verdict) => [verdict.findingId, verdict]));
  const confirmed = findings.filter((finding) => verdictById.get(finding.id)?.status === CONFIRMED);
  const uniqueConfirmed = confirmed
    .filter((finding) => !verdictById.get(finding.id)?.duplicateOf)
    .map((finding) => ({
      ...finding,
      severity: verdictById.get(finding.id)?.severity ?? finding.severity,
    }));
  const finalMatches = matchExpected(evaluationCase.expected, uniqueConfirmed);
  const matchedFindingIds = new Set(finalMatches.flatMap((match) => match.findingIds));
  const severityCorrectCount = finalMatches.filter((match) => match.severityCorrect).length;

  return {
    caseId: evaluationCase.id,
    missingRun: !run,
    expectedCount: evaluationCase.expected.length,
    detectedCount: finalMatches.length,
    confirmedCount: uniqueConfirmed.length,
    duplicateConfirmedCount: confirmed.length - uniqueConfirmed.length,
    truePositiveCount: finalMatches.length,
    severityCorrectCount,
    rawFalsePositiveCount: findings.filter((finding) => !matchesAnyExpected(finding, evaluationCase.expected)).length,
    falsePositiveCount: Math.max(0, uniqueConfirmed.length - matchedFindingIds.size),
    missed: evaluationCase.expected.filter((expected) => !finalMatches.some((match) => match.expectedId === expected.id)).map((item) => item.id),
  };
}

function matchExpected(expectedIssues, findings) {
  const usedFindingIds = new Set();
  return expectedIssues.flatMap((expected) => {
    const match = findings.find((finding) => (
      !usedFindingIds.has(finding.id) && matchesAliases(finding, expected.aliases)
    ));
    if (!match) return [];
    usedFindingIds.add(match.id);
    return [{
      expectedId: expected.id,
      findingIds: [match.id],
      severityCorrect: match.severity === expected.severity,
    }];
  });
}

function matchesAnyExpected(finding, expectedIssues) {
  return expectedIssues.some((expected) => matchesAliases(finding, expected.aliases));
}

function matchesAliases(finding, aliases) {
  const text = [
    finding.title,
    finding.category,
    finding.impact,
    finding.recommendation,
    finding.verification,
    ...(finding.evidence ?? []).flatMap((item) => [item.path, item.observation]),
  ].filter(Boolean).join(" ").toLocaleLowerCase();
  return aliases.some((alias) => text.includes(alias.toLocaleLowerCase()));
}

function ratio(numerator, denominator) {
  return denominator === 0 ? null : Number((numerator / denominator).toFixed(4));
}
