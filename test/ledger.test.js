import assert from "node:assert/strict";
import { access, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { FileLedger } from "../dist/ledger/file-ledger.js";

test("replaces a lock owned by a process that no longer exists", async () => {
  const repoPath = await mkdtemp(join(tmpdir(), "reviewctl-lock-"));
  const ledger = await FileLedger.create("review-lock-test", repoPath, { reviewId: "review-lock-test" });
  const lockPath = join(ledger.reviewDir, "run.lock");
  await writeFile(lockPath, "99999999\n", "utf8");

  await ledger.acquireLock();
  await access(lockPath);
  await ledger.releaseLock();
  await assert.rejects(access(lockPath));
});
