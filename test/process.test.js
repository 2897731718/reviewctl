import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runProcess } from "../dist/adapters/process.js";

test("waits for a timed-out process to close before rejecting", async () => {
  await assertTerminatedBeforeRejection({
    script: `
      require("node:fs").writeFileSync(process.env.PID_FILE, String(process.pid));
      process.on("SIGTERM", () => {});
      setInterval(() => {}, 1_000);
    `,
    timeoutMs: 200,
    expectedError: /timed out/u,
  });
});

test("force-kills an output-limited process and waits for close", async () => {
  await assertTerminatedBeforeRejection({
    script: `
      require("node:fs").writeFileSync(process.env.PID_FILE, String(process.pid));
      process.on("SIGTERM", () => {});
      const chunk = "x".repeat(1024 * 1024);
      for (let index = 0; index < 12; index += 1) process.stdout.write(chunk);
      setInterval(() => {}, 1_000);
    `,
    timeoutMs: 10_000,
    expectedError: /10 MiB output limit/u,
  });
});

async function assertTerminatedBeforeRejection({ script, timeoutMs, expectedError }) {
  const directory = await mkdtemp(join(tmpdir(), "reviewctl-process-"));
  const pidFile = join(directory, "pid");
  await assert.rejects(runProcess(process.execPath, ["-e", script], {
    cwd: directory,
    stdin: "",
    timeoutMs,
    env: { ...process.env, PID_FILE: pidFile },
  }), expectedError);

  const pid = Number.parseInt(await readFile(pidFile, "utf8"), 10);
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
}
