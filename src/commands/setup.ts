import { installBundledSkill } from "../core/skill-installer.js";
import type { SkillTarget } from "../core/skill-installer.js";
import { runDoctor } from "./doctor.js";

export function setupHelp(): string {
  return `Usage:
  reviewctl setup [options]

Options:
  --target <auto|all|codex|claude|shared>  Installation target (default: auto)
  --force                                    Replace a locally modified skill
  --dry-run                                  Show destinations without writing
  -h, --help                                 Show this help

The command installs only the bundled adversarial-project-review skill. It does
not edit provider configuration, credentials, hooks, or shell startup files.`;
}

export async function runSetupCommand(args: readonly string[]): Promise<string> {
  const options = parseArgs(args);
  const targets = options.target === "auto" ? detectTargets() : expandTarget(options.target);
  const results = await installBundledSkill({
    targets,
    force: options.force,
    dryRun: options.dryRun,
  });
  return [
    options.dryRun ? "Setup plan:" : "Skill setup complete:",
    ...results.map((result) => `- ${result.target}: ${result.status} (${result.path})`),
    "Restart or open a new AI session so skill discovery refreshes.",
  ].join("\n");
}

function parseArgs(args: readonly string[]): {
  target: "auto" | "all" | SkillTarget;
  force: boolean;
  dryRun: boolean;
} {
  let target: "auto" | "all" | SkillTarget = "auto";
  let force = false;
  let dryRun = false;
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index]!;
    if (value === "--target") {
      const candidate = args[index + 1];
      if (!candidate || !["auto", "all", "codex", "claude", "shared"].includes(candidate)) {
        throw new Error("--target must be auto, all, codex, claude, or shared");
      }
      target = candidate as typeof target;
      index += 1;
    } else if (value === "--force") force = true;
    else if (value === "--dry-run") dryRun = true;
    else throw new Error(`Unknown setup option: ${value}`);
  }
  return { target, force, dryRun };
}

function detectTargets(): SkillTarget[] {
  const installed = runDoctor().agents.filter((item) => item.available).map((item) => item.provider);
  if (installed.length === 0) {
    throw new Error("No Codex or Claude CLI installation was detected; choose --target explicitly");
  }
  return installed;
}

function expandTarget(target: "all" | SkillTarget): SkillTarget[] {
  return target === "all" ? ["codex", "claude"] : [target];
}
