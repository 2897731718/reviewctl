import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export type SkillTarget = "codex" | "claude" | "shared";

export interface InstallSkillInput {
  targets: SkillTarget[];
  force?: boolean;
  dryRun?: boolean;
  home?: string;
  env?: NodeJS.ProcessEnv;
  sourceDir?: string;
}

export interface SkillInstallResult {
  target: SkillTarget;
  path: string;
  status: "installed" | "updated" | "up-to-date" | "planned" | "conflict";
}

const SKILL_NAME = "adversarial-project-review";

export async function installBundledSkill(input: InstallSkillInput): Promise<SkillInstallResult[]> {
  const home = input.home ?? homedir();
  const env = input.env ?? process.env;
  const source = input.sourceDir ?? fileURLToPath(
    new URL(`../../skills/${SKILL_NAME}/`, import.meta.url),
  );
  await assertDirectory(source, "Bundled skill source is missing");
  const uniqueTargets = [...new Set(input.targets)];
  if (uniqueTargets.length === 0) throw new Error("At least one setup target is required");

  const plans = [];
  for (const target of uniqueTargets) {
    const destination = resolveDestination(target, home, env);
    const existing = await exists(destination);
    const upToDate = existing && await sameTree(source, destination);
    const conflict = existing && !upToDate && !input.force;
    if (conflict && !input.dryRun) {
      throw new Error(`Skill already exists with different content: ${destination}. Use --force to replace it.`);
    }
    plans.push({ target, destination, existing, upToDate, conflict });
  }

  const results: SkillInstallResult[] = [];
  for (const plan of plans) {
    if (plan.conflict) {
      results.push({ target: plan.target, path: plan.destination, status: "conflict" });
    } else if (plan.upToDate) {
      results.push({ target: plan.target, path: plan.destination, status: "up-to-date" });
    } else if (input.dryRun) {
      results.push({ target: plan.target, path: plan.destination, status: "planned" });
    } else {
      await atomicReplace(source, plan.destination, plan.existing);
      results.push({
        target: plan.target,
        path: plan.destination,
        status: plan.existing ? "updated" : "installed",
      });
    }
  }
  return results;
}

function resolveDestination(target: SkillTarget, home: string, env: NodeJS.ProcessEnv): string {
  if (target === "codex") {
    return join(env.CODEX_HOME ?? join(home, ".codex"), "skills", SKILL_NAME);
  }
  if (target === "claude") {
    return join(env.CLAUDE_CONFIG_DIR ?? join(home, ".claude"), "skills", SKILL_NAME);
  }
  return join(home, ".agents", "skills", SKILL_NAME);
}

async function atomicReplace(source: string, destination: string, existing: boolean): Promise<void> {
  const parent = dirname(destination);
  await mkdir(parent, { recursive: true });
  const suffix = randomUUID();
  const temporary = `${destination}.tmp-${suffix}`;
  const backup = `${destination}.backup-${suffix}`;
  await cp(source, temporary, { recursive: true, errorOnExist: true });
  if (!existing) {
    await rename(temporary, destination);
    return;
  }
  await rename(destination, backup);
  try {
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    await rename(backup, destination);
    throw error;
  }
  await rm(backup, { recursive: true, force: true });
}

async function sameTree(left: string, right: string): Promise<boolean> {
  try {
    return await fingerprint(left) === await fingerprint(right);
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

async function fingerprint(root: string): Promise<string> {
  const hash = createHash("sha256");
  const files = await listFiles(root);
  for (const file of files) {
    hash.update(relative(root, file));
    hash.update("\0");
    hash.update(await readFile(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

async function listFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(path));
    else if (entry.isFile()) files.push(path);
    else throw new Error(`Skill contains unsupported filesystem entry: ${path}`);
  }
  return files.sort();
}

async function assertDirectory(path: string, message: string): Promise<void> {
  try {
    if (!(await stat(path)).isDirectory()) throw new Error(message);
  } catch (error) {
    if (isMissing(error)) throw new Error(message);
    throw error;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
