import type { AgentProvider } from "../types.js";

export interface AgentRunRequest {
  runId: string;
  repoPath: string;
  artifactDir: string;
  prompt: string;
  schema: object;
  timeoutMs: number;
}

export interface AgentRunResult {
  provider: AgentProvider;
  rawOutput: string;
  stdout: string;
  stderr: string;
}

export interface AgentAdapter {
  readonly provider: AgentProvider;
  run(request: AgentRunRequest): Promise<AgentRunResult>;
}
