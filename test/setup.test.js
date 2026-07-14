import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { installBundledSkill } from "../dist/index.js";

test("installs the bundled skill idempotently and protects local modifications", async () => {
  const home = await mkdtemp(join(tmpdir(), "reviewctl-setup-"));
  const first = await installBundledSkill({ targets: ["codex"], home, env: {} });
  assert.equal(first[0].status, "installed");
  const skillPath = join(home, ".codex", "skills", "adversarial-project-review", "SKILL.md");
  assert.match(await readFile(skillPath, "utf8"), /Guard against recursion/u);

  const second = await installBundledSkill({ targets: ["codex"], home, env: {} });
  assert.equal(second[0].status, "up-to-date");

  await writeFile(skillPath, "local change\n", "utf8");
  await assert.rejects(
    installBundledSkill({ targets: ["codex"], home, env: {} }),
    /Use --force/u,
  );
  const replaced = await installBundledSkill({ targets: ["codex"], home, env: {}, force: true });
  assert.equal(replaced[0].status, "updated");
  assert.match(await readFile(skillPath, "utf8"), /Guard against recursion/u);
});

test("dry-run reports destinations without writing", async () => {
  const home = await mkdtemp(join(tmpdir(), "reviewctl-setup-dry-"));
  const result = await installBundledSkill({
    targets: ["codex", "claude", "shared"],
    home,
    env: {},
    dryRun: true,
  });
  assert.deepEqual(result.map((item) => item.status), ["planned", "planned", "planned"]);
  await assert.rejects(readFile(join(home, ".codex", "skills", "adversarial-project-review", "SKILL.md")));
});

test("preflights every target before writing any destination", async () => {
  const home = await mkdtemp(join(tmpdir(), "reviewctl-setup-preflight-"));
  await installBundledSkill({ targets: ["claude"], home, env: {} });
  const claudeSkill = join(home, ".claude", "skills", "adversarial-project-review", "SKILL.md");
  await writeFile(claudeSkill, "local change\n", "utf8");

  await assert.rejects(
    installBundledSkill({ targets: ["codex", "claude"], home, env: {} }),
    /Use --force/u,
  );
  const codexSkill = join(home, ".codex", "skills", "adversarial-project-review", "SKILL.md");
  await assert.rejects(readFile(codexSkill));
});
