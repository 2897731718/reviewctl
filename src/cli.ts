#!/usr/bin/env node

import { createRequire } from "node:module";

import { formatDoctor, runDoctor } from "./commands/doctor.js";
import { reviewHelp, runReviewCommand } from "./commands/review.js";
import { runReportCommand } from "./commands/report.js";
import { runResumeCommand } from "./commands/resume.js";
import { runStatusCommand } from "./commands/status.js";
import { runSetupCommand, setupHelp } from "./commands/setup.js";
import { runVerifyCommand } from "./commands/verify.js";

const require = createRequire(import.meta.url);
const VERSION = (require("../package.json") as { version: string }).version;

function help(): string {
  return `reviewctl ${VERSION}

Evidence-driven adversarial reviews across AI coding agents.

Usage:
  reviewctl <command>

Commands:
  doctor      Detect supported local agent CLIs
  review      Run an isolated adversarial review
  resume      Resume a failed or interrupted review
  report      Rebuild a Markdown report from a snapshot
  status      Show recent review runs
  verify      Re-check findings against the current repository
  setup       Install the bundled AI skill explicitly
  help        Show this help

Options:
  -v, --version   Show version
  -h, --help      Show this help`;
}

async function main(args: readonly string[]): Promise<number> {
  const command = args[0] ?? "help";

  if (command === "doctor") {
    const result = runDoctor();
    console.log(formatDoctor(result));
    return result.usableProviders > 0 ? 0 : 1;
  }

  if (command === "review") {
    if (args[1] === "--help" || args[1] === "-h") {
      console.log(reviewHelp());
      return 0;
    }
    console.log(await runReviewCommand(args.slice(1)));
    return 0;
  }

  if (command === "status") {
    console.log(await runStatusCommand());
    return 0;
  }

  if (command === "resume") {
    console.log(await runResumeCommand(args.slice(1)));
    return 0;
  }

  if (command === "report") {
    console.log(await runReportCommand(args.slice(1)));
    return 0;
  }

  if (command === "verify") {
    console.log(await runVerifyCommand(args.slice(1)));
    return 0;
  }

  if (command === "setup") {
    if (args[1] === "--help" || args[1] === "-h") {
      console.log(setupHelp());
      return 0;
    }
    console.log(await runSetupCommand(args.slice(1)));
    return 0;
  }

  if (command === "help" || command === "--help" || command === "-h") {
    console.log(help());
    return 0;
  }

  if (command === "--version" || command === "-v") {
    console.log(VERSION);
    return 0;
  }

  console.error(`Unknown command: ${command}\n`);
  console.error(help());
  return 2;
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  console.error(`reviewctl: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
