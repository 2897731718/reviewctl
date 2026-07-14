import { spawnSync } from "node:child_process";

import type { AgentHealth, AgentSpec } from "../types.js";

export interface CommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: NodeJS.ErrnoException;
}

export type CommandRunner = (
  command: string,
  args: readonly string[],
) => CommandResult;

const defaultRunner: CommandRunner = (command, args) => {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    shell: false,
    timeout: 5_000,
  });

  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    ...(result.error ? { error: result.error } : {}),
  };
};

export function detectAgent(
  spec: AgentSpec,
  runner: CommandRunner = defaultRunner,
): AgentHealth {
  const result = runner(spec.command, spec.versionArgs);
  const version = firstLine(result.stdout) ?? firstLine(result.stderr);

  if (!result.error && result.status === 0) {
    return {
      provider: spec.provider,
      command: spec.command,
      available: true,
      ...(version ? { version } : {}),
    };
  }

  return {
    provider: spec.provider,
    command: spec.command,
    available: false,
    error: result.error?.message ?? version ?? `Exited with status ${result.status}`,
  };
}

function firstLine(value: string): string | undefined {
  return value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find(Boolean);
}
