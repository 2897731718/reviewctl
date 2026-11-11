import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("CLI version matches package.json", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const output = execFileSync(process.execPath, [new URL("../dist/cli.js", import.meta.url).pathname, "--version"], {
    encoding: "utf8",
  }).trim();

  assert.equal(output, packageJson.version);
});
