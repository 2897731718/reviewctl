export const REVIEW_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["phase", "summary", "findings"],
  properties: {
    phase: { const: "independent_review" },
    summary: { type: "string" },
    findings: {
      type: "array",
      items: { $ref: "#/$defs/finding" },
    },
  },
  $defs: commonDefinitions(),
} as const;

export const CHALLENGE_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["phase", "summary", "challenges"],
  properties: {
    phase: { const: "cross_challenge" },
    summary: { type: "string" },
    challenges: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["targetId", "reason", "evidence"],
        properties: {
          targetId: { type: "string" },
          reason: { type: "string" },
          evidence: { type: "array", items: { $ref: "#/$defs/evidence" } },
          proposedStatus: {
            enum: ["CONFIRMED", "DISPUTED", "WITHDRAWN", "UNVERIFIED"],
          },
        },
      },
    },
  },
  $defs: commonDefinitions(),
} as const;

export const VERDICT_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["phase", "summary", "verdicts"],
  properties: {
    phase: { const: "adjudication" },
    summary: { type: "string" },
    verdicts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["findingId", "status", "rationale"],
        properties: {
          findingId: { type: "string" },
          status: {
            enum: ["CONFIRMED", "DISPUTED", "WITHDRAWN", "UNVERIFIED"],
          },
          severity: { enum: ["P0", "P1", "P2", "P3"] },
          rationale: { type: "string" },
          duplicateOf: { type: "string" },
        },
      },
    },
  },
} as const;

export const VERIFICATION_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["phase", "summary", "verifications"],
  properties: {
    phase: { const: "verification" },
    summary: { type: "string" },
    verifications: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["findingId", "status", "rationale", "evidence"],
        properties: {
          findingId: { type: "string" },
          status: { enum: ["RESOLVED", "STILL_PRESENT", "UNVERIFIED"] },
          rationale: { type: "string" },
          evidence: { type: "array", items: { $ref: "#/$defs/evidence" } },
        },
      },
    },
  },
  $defs: commonDefinitions(),
} as const;

function commonDefinitions() {
  return {
    evidence: {
      type: "object",
      additionalProperties: false,
      required: ["path", "observation"],
      properties: {
        path: { type: "string" },
        line: { type: "integer", minimum: 1 },
        observation: { type: "string" },
      },
    },
    finding: {
      type: "object",
      additionalProperties: false,
      required: [
        "title",
        "severity",
        "confidence",
        "category",
        "evidence",
        "impact",
        "recommendation",
        "verification",
      ],
      properties: {
        title: { type: "string" },
        severity: { enum: ["P0", "P1", "P2", "P3"] },
        confidence: { enum: ["low", "medium", "high"] },
        category: { type: "string" },
        evidence: { type: "array", items: { $ref: "#/$defs/evidence" } },
        impact: { type: "string" },
        reproduction: { type: "string" },
        recommendation: { type: "string" },
        verification: { type: "string" },
      },
    },
  };
}
