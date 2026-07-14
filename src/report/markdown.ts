import type { ReviewSnapshot, Verdict } from "../protocol/types.js";

const SEVERITY_ORDER = { P0: 0, P1: 1, P2: 2, P3: 3 } as const;

export function renderMarkdownReport(snapshot: ReviewSnapshot): string {
  const verdictById = new Map(snapshot.verdicts.map((verdict) => [verdict.findingId, verdict]));
  const verificationById = new Map((snapshot.verifications ?? []).map((item) => [item.findingId, item]));
  const findings = [...snapshot.findings].sort((left, right) => (
    SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity]
  ));
  const confirmed = snapshot.verdicts.filter((item) => item.status === "CONFIRMED").length;
  const resolved = (snapshot.verifications ?? []).filter((item) => item.status === "RESOLVED").length;

  const sections = findings.map((finding) => {
    const verdict = verdictById.get(finding.id) ?? unverifiedVerdict(finding.id);
    const verification = verificationById.get(finding.id);
    const verificationEvidence = verification?.evidence.length
      ? verification.evidence.map((item) => (
          `- \`${sanitizeCode(item.path)}${item.line ? `:${item.line}` : ""}\` — ${sanitizeBlock(item.observation)}`
        )).join("\n")
      : "- No additional verification evidence supplied.";
    const evidence = finding.evidence.length === 0
      ? "- No concrete evidence supplied."
      : finding.evidence.map((item) => (
        `- \`${sanitizeCode(item.path)}${item.line ? `:${item.line}` : ""}\` — ${sanitizeBlock(item.observation)}`
      )).join("\n");
    return `## ${sanitizeInline(finding.id)}: ${sanitizeInline(finding.title)}

- Severity: **${verdict.severity ?? finding.severity}**
- Status: **${verdict.status}**
${verification ? `- Latest verification: **${verification.status}** (${verification.provider}, ${verification.verifiedAt})` : "- Latest verification: not run"}
- Confidence: ${sanitizeInline(finding.confidence)}
- Category: ${sanitizeInline(finding.category)}
- Reviewer: ${sanitizeInline(finding.actorId)} (${finding.provider})

### Evidence

${evidence}

### Impact

${sanitizeBlock(finding.impact)}

### Recommendation

${sanitizeBlock(finding.recommendation)}

### Verification

${sanitizeBlock(finding.verification)}

### Verdict rationale

${sanitizeBlock(verdict.rationale)}${verdict.duplicateOf ? `\n\nDuplicate of: ${sanitizeInline(verdict.duplicateOf)}` : ""}${verification ? `\n\n### Latest verification rationale\n\n${sanitizeBlock(verification.rationale)}\n\n### Latest verification evidence\n\n${verificationEvidence}` : ""}`;
  });

  return `# Adversarial review report

- Review: \`${snapshot.reviewId}\`
- Repository: \`${sanitizeCode(snapshot.repoPath)}\`
- Scope: ${snapshot.scope}
- Status: ${snapshot.status}
- Findings: ${snapshot.findings.length}
- Confirmed: ${confirmed}
- Resolved after verification: ${resolved}
- Completed: ${snapshot.completedAt}

## Executive summary

${sanitizeBlock(snapshot.summary)}

${sections.length > 0 ? sections.join("\n\n---\n\n") : "## Findings\n\nNo findings were reported."}
`;
}

function sanitizeBlock(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replace(/!\[/gu, "\\![");
}

function sanitizeInline(value: string): string {
  return sanitizeBlock(value).replace(/\r?\n/gu, " ");
}

function sanitizeCode(value: string): string {
  return sanitizeInline(value).replaceAll("`", "'");
}

function unverifiedVerdict(findingId: string): Verdict {
  return {
    findingId,
    status: "UNVERIFIED",
    rationale: "The judge did not return a valid verdict for this finding.",
  };
}
