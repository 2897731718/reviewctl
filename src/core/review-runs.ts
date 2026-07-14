import { readdir } from "node:fs/promises";
import { join } from "node:path";

export async function resolveReviewId(repoPath: string, requested?: string): Promise<string> {
  if (requested) {
    if (!/^review-[A-Za-z0-9-]+$/u.test(requested)) throw new Error(`Invalid review id: ${requested}`);
    return requested;
  }
  const root = join(repoPath, ".ai-review", "reviews");
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) throw new Error("No review runs found in this repository");
    throw error;
  }
  const latest = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().at(-1);
  if (!latest) throw new Error("No review runs found in this repository");
  return latest;
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
