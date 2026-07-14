import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { resolveRepository } from "../core/repository.js";

export async function runStatusCommand(cwd = process.cwd()): Promise<string> {
  const repoPath = resolveRepository(cwd);
  const root = join(repoPath, ".ai-review", "reviews");
  let reviewIds: string[];
  try {
    reviewIds = (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .reverse();
  } catch (error) {
    if (isMissing(error)) return "No review runs found in this repository.";
    throw error;
  }
  if (reviewIds.length === 0) return "No review runs found in this repository.";

  const lines = await Promise.all(reviewIds.slice(0, 10).map(async (reviewId) => {
    const directory = join(root, reviewId);
    try {
      const snapshot = JSON.parse(await readFile(join(directory, "snapshot.json"), "utf8")) as {
        status?: unknown;
        findings?: unknown[];
        verdicts?: Array<{ status?: unknown }>;
      };
      const confirmed = snapshot.verdicts?.filter((item) => item.status === "CONFIRMED").length ?? 0;
      return `${reviewId}  ${String(snapshot.status ?? "UNKNOWN").padEnd(10)} findings=${snapshot.findings?.length ?? 0} confirmed=${confirmed}`;
    } catch (error) {
      if (!isMissing(error)) throw error;
      const lastEvent = await readLastEventType(join(directory, "events.ndjson"));
      return `${reviewId}  ${lastEvent}`;
    }
  }));
  return ["Review ID                                     Status", ...lines].join("\n");
}

async function readLastEventType(path: string): Promise<string> {
  try {
    const lines = (await readFile(path, "utf8")).trim().split("\n");
    const last = JSON.parse(lines.at(-1) ?? "{}") as { type?: unknown };
    return String(last.type ?? "CREATED");
  } catch (error) {
    if (isMissing(error)) return "CREATED";
    throw error;
  }
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
