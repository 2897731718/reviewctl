import type { AgentProvider } from "../types.js";

export type ReviewScope = "architecture" | "implementation" | "full";
export type Severity = "P0" | "P1" | "P2" | "P3";
export type Confidence = "low" | "medium" | "high";
export type VerdictStatus = "CONFIRMED" | "DISPUTED" | "WITHDRAWN" | "UNVERIFIED";
export type VerificationStatus = "RESOLVED" | "STILL_PRESENT" | "UNVERIFIED";

export interface Evidence {
  path: string;
  line?: number;
  observation: string;
}

export interface FindingDraft {
  title: string;
  severity: Severity;
  confidence: Confidence;
  category: string;
  evidence: Evidence[];
  impact: string;
  reproduction?: string;
  recommendation: string;
  verification: string;
}

export interface Finding extends FindingDraft {
  id: string;
  actorId: string;
  provider: AgentProvider;
}

export interface Challenge {
  targetId: string;
  reason: string;
  evidence: Evidence[];
  proposedStatus?: VerdictStatus;
  actorId: string;
  provider: AgentProvider;
}

export interface Verdict {
  findingId: string;
  status: VerdictStatus;
  severity?: Severity;
  rationale: string;
  duplicateOf?: string;
}

export interface ReviewPayload {
  phase: "independent_review";
  summary: string;
  findings: FindingDraft[];
}

export interface ChallengePayload {
  phase: "cross_challenge";
  summary: string;
  challenges: Array<Omit<Challenge, "actorId" | "provider">>;
}

export interface VerdictPayload {
  phase: "adjudication";
  summary: string;
  verdicts: Verdict[];
}

export interface Verification {
  findingId: string;
  status: VerificationStatus;
  rationale: string;
  evidence: Evidence[];
  provider: AgentProvider;
  verifiedAt: string;
}

export interface VerificationPayload {
  phase: "verification";
  summary: string;
  verifications: Array<Omit<Verification, "provider" | "verifiedAt">>;
}

export interface Participant {
  actorId: string;
  provider: AgentProvider;
  role: "reviewer" | "judge";
}

export interface ReviewSnapshot {
  schemaVersion: "1.0";
  reviewId: string;
  status: "COMPLETED" | "FAILED";
  repoPath: string;
  scope: ReviewScope;
  base?: string;
  spec?: string;
  participants: Participant[];
  findings: Finding[];
  challenges: Challenge[];
  verdicts: Verdict[];
  verifications?: Verification[];
  summary: string;
  createdAt: string;
  completedAt: string;
}
