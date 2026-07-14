import { spawnSync } from "node:child_process";
import { lstat, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

export function resolveRepository(cwd: string): string {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    encoding: "utf8",
    shell: false,
    timeout: 5_000,
  });
  if (result.status !== 0) throw new Error("This command must run inside a Git repository");
  return result.stdout.trim();
}

export async function resolveProjectFile(
  repoPath: string,
  value: string,
  label: string,
): Promise<string> {
  const lexicalPath = resolveProjectPath(repoPath, value, label);
  const info = await stat(lexicalPath);
  if (!info.isFile()) throw new Error(`${label} must be a file: ${value}`);
  const canonicalPath = await realpath(lexicalPath);
  assertInside(repoPath, canonicalPath, label, value);
  return canonicalPath;
}

export async function resolveProjectOutput(
  repoPath: string,
  value: string,
  label: string,
): Promise<string> {
  const path = resolveProjectPath(repoPath, value, label);
  const canonicalParent = await realpath(dirname(path));
  assertInside(repoPath, canonicalParent, label, value);
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink()) throw new Error(`${label} cannot be a symbolic link: ${value}`);
    if (info.isDirectory()) throw new Error(`${label} cannot be a directory: ${value}`);
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  return path;
}

export function resolveProjectPath(repoPath: string, value: string, label: string): string {
  const path = resolve(repoPath, value);
  assertInside(repoPath, path, label, value);
  return path;
}

function assertInside(repoPath: string, path: string, label: string, value: string): void {
  const relation = relative(repoPath, path);
  if (relation === ".." || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
    throw new Error(`${label} must stay inside the repository: ${value}`);
  }
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
