import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface LedgerEvent {
  eventId: string;
  reviewId: string;
  type: string;
  createdAt: string;
  data: unknown;
}

export class FileLedger {
  readonly reviewDir: string;
  readonly artifactDir: string;
  private writeQueue: Promise<void> = Promise.resolve();

  private constructor(
    readonly reviewId: string,
    readonly repoPath: string,
  ) {
    this.reviewDir = join(repoPath, ".ai-review", "reviews", reviewId);
    this.artifactDir = join(this.reviewDir, "artifacts");
  }

  static async create(reviewId: string, repoPath: string, manifest: object): Promise<FileLedger> {
    const ledger = new FileLedger(reviewId, repoPath);
    await mkdir(ledger.artifactDir, { recursive: true });
    await writeFile(
      join(ledger.reviewDir, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { encoding: "utf8", flag: "wx" },
    );
    return ledger;
  }

  static async open(reviewId: string, repoPath: string): Promise<FileLedger> {
    if (!/^review-[A-Za-z0-9-]+$/u.test(reviewId)) throw new Error(`Invalid review id: ${reviewId}`);
    const ledger = new FileLedger(reviewId, repoPath);
    await readFile(join(ledger.reviewDir, "manifest.json"), "utf8");
    return ledger;
  }

  async readManifest<T>(): Promise<T> {
    return JSON.parse(await readFile(join(this.reviewDir, "manifest.json"), "utf8")) as T;
  }

  async readEvents(): Promise<LedgerEvent[]> {
    try {
      const content = await readFile(join(this.reviewDir, "events.ndjson"), "utf8");
      return content.split("\n").filter(Boolean).map((line) => JSON.parse(line) as LedgerEvent);
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }
  }

  async acquireLock(): Promise<void> {
    const path = join(this.reviewDir, "run.lock");
    try {
      await writeFile(path, `${process.pid}\n`, { encoding: "utf8", flag: "wx" });
    } catch (error) {
      if (!isExists(error)) throw error;
      const owner = Number.parseInt((await readFile(path, "utf8")).trim(), 10);
      if (Number.isInteger(owner) && isProcessAlive(owner)) {
        throw new Error(`Review ${this.reviewId} is already running in process ${owner}`);
      }
      await unlink(path);
      await writeFile(path, `${process.pid}\n`, { encoding: "utf8", flag: "wx" });
    }
  }

  async releaseLock(): Promise<void> {
    try {
      await unlink(join(this.reviewDir, "run.lock"));
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }

  append(type: string, data: unknown): Promise<void> {
    const event: LedgerEvent = {
      eventId: randomUUID(),
      reviewId: this.reviewId,
      type,
      createdAt: new Date().toISOString(),
      data,
    };
    this.writeQueue = this.writeQueue.then(() => appendFile(
      join(this.reviewDir, "events.ndjson"),
      `${JSON.stringify(event)}\n`,
      "utf8",
    ));
    return this.writeQueue;
  }

  async writeArtifact(name: string, content: string): Promise<string> {
    const path = join(this.artifactDir, name);
    await writeFile(path, content, "utf8");
    return path;
  }

  async writeSnapshot(snapshot: object): Promise<string> {
    const target = join(this.reviewDir, "snapshot.json");
    const temporary = `${target}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    await rename(temporary, target);
    return target;
  }
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function isExists(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(typeof error === "object" && error !== null && "code" in error && error.code === "ESRCH");
  }
}

export function createReviewId(now = new Date()): string {
  const timestamp = now.toISOString().replace(/[-:]/gu, "").replace(/\.\d{3}Z$/u, "Z");
  return `review-${timestamp}-${randomUUID().slice(0, 8)}`;
}
