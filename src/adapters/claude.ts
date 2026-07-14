import type { AgentAdapter, AgentRunRequest, AgentRunResult } from "./agent-adapter.js";
import { runProcess } from "./process.js";
import type { ProcessRunner } from "./process.js";
import { buildAgentEnvironment } from "../security/environment.js";

export class ClaudeAdapter implements AgentAdapter {
  readonly provider = "claude" as const;

  constructor(
    private readonly processRunner: ProcessRunner = runProcess,
    private readonly sourceEnv: NodeJS.ProcessEnv = process.env,
  ) {}

  async run(request: AgentRunRequest): Promise<AgentRunResult> {
    const args = [
      "--print",
      "--output-format", "json",
      "--json-schema", JSON.stringify(request.schema),
      "--permission-mode", "plan",
      "--tools", "Read,Grep,Glob",
      "--no-session-persistence",
      "--safe-mode",
    ];
    const result = await this.processRunner("claude", args, {
      cwd: request.repoPath,
      stdin: request.prompt,
      timeoutMs: request.timeoutMs,
      env: buildAgentEnvironment(this.provider, this.sourceEnv),
    });
    return {
      provider: this.provider,
      rawOutput: result.stdout,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }
}
