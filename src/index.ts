export { detectAgent } from "./core/detect-agent.js";
export { detectAuthentication } from "./commands/doctor.js";
export type { AuthenticationDetectionOptions } from "./commands/doctor.js";
export { installBundledSkill } from "./core/skill-installer.js";
export type { InstallSkillInput, SkillInstallResult, SkillTarget } from "./core/skill-installer.js";
export type { CommandResult, CommandRunner } from "./core/detect-agent.js";
export { resumeReview, runReview } from "./orchestrator/review.js";
export { verifyFindings } from "./orchestrator/verify.js";
export { selectJudge, selectReviewers } from "./orchestrator/select-participants.js";
export type { RunReviewInput, RunReviewResult } from "./orchestrator/review.js";
export type {
  Challenge,
  Finding,
  Participant,
  ReviewScope,
  ReviewSnapshot,
  Verdict,
  Verification,
} from "./protocol/types.js";
export type { AgentHealth, AgentProvider, AgentSpec } from "./types.js";
