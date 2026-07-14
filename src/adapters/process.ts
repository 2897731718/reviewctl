import { spawn } from "node:child_process";

import { redactSensitiveText } from "../security/redact.js";

export interface ProcessResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export type ProcessRunner = typeof runProcess;

const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

export function runProcess(
  command: string,
  args: readonly string[],
  options: { cwd: string; stdin: string; timeoutMs: number; env?: NodeJS.ProcessEnv },
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;
    let terminationError: Error | undefined;
    let killTimer: NodeJS.Timeout | undefined;

    const timer = setTimeout(() => {
      terminate(new Error(`Agent process timed out after ${options.timeoutMs}ms`));
    }, options.timeoutMs);

    const collect = (target: Buffer[]) => (chunk: Buffer) => {
      if (terminationError) return;
      outputBytes += chunk.length;
      if (outputBytes > MAX_OUTPUT_BYTES) {
        terminate(new Error("Agent process exceeded the 10 MiB output limit"));
        return;
      }
      target.push(chunk);
    };

    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));
    child.on("error", (error) => {
      if (!terminationError) finish(error);
    });
    child.on("close", (exitCode) => {
      if (terminationError) {
        finish(terminationError);
        return;
      }
      if (exitCode !== 0) {
        finish(new Error(
          `${command} exited with status ${exitCode}: ${redactSensitiveText(Buffer.concat(stderr).toString("utf8").trim())}`,
        ));
        return;
      }
      finish(undefined, {
        exitCode,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });

    child.stdin.end(options.stdin);

    function terminate(error: Error): void {
      if (terminationError || settled) return;
      terminationError = error;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), 2_000);
    }

    function finish(error?: Error, result?: ProcessResult): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      if (error) reject(error);
      else if (result) resolve(result);
    }
  });
}
