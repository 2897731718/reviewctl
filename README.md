# reviewctl

[English](README.md) | [简体中文](README.zh-CN.md)

Evidence-driven adversarial reviews across AI coding agents.

`reviewctl` is a local-first CLI that will coordinate isolated Codex and Claude
sessions, preserve their evidence in a resumable ledger, and generate a final
review report. It is designed to work with either one provider or multiple
providers; a single available provider can run multiple isolated reviewer roles.

## Current status

This repository is an early V0.1 implementation. It can check provider health
and run an independent review, cross-challenge, and adjudication pipeline:

```bash
npm install
npm run build
node dist/cli.js doctor
node dist/cli.js review --scope full
node dist/cli.js setup --dry-run
```

At least one of the following must be installed and authenticated before a
review can run:

- Codex CLI
- Claude Code CLI

Credential detection supports stored CLI login state and environment-provided
`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `ANTHROPIC_AUTH_TOKEN`. Environment
variables are checked only for non-empty presence: their values are never
logged or persisted, and validity is not tested until a real agent call runs.

Claude-compatible API gateways must expose their environment variables to the
`reviewctl` process so its child `claude` process can inherit them:

```bash
export ANTHROPIC_AUTH_TOKEN="..."
export ANTHROPIC_BASE_URL="https://gateway.example.com"
export ANTHROPIC_MODEL="claude-model-name"
reviewctl doctor
reviewctl review --scope implementation --base HEAD
```

The variables can instead be scoped to one invocation. A shell alias that sets
them only while launching `claude` is not inherited by `reviewctl` and will not
configure the Claude provider:

```bash
ANTHROPIC_AUTH_TOKEN="..." \
ANTHROPIC_BASE_URL="https://gateway.example.com" \
ANTHROPIC_MODEL="claude-model-name" \
reviewctl review --scope implementation --base HEAD
```

Agent processes receive a provider-specific environment allowlist instead of
the caller's complete environment. Codex review sessions also ignore local
rules and user configuration, run read-only, and do not pass CLI credentials
into model-invoked shell commands. Stored model output and errors have known
credential values and common token shapes redacted before schema validation,
ledger writes, snapshots, and report generation.

## Recommended workflow: review and fix in one AI session

The main entry point is the current Codex or Claude session. It invokes
`reviewctl` to start isolated reviewers and a judge, waits for the report, and
summarizes the result. After the user approves the findings, the same session
fixes the code and invokes `reviewctl verify`.

```text
Current Codex / Claude session
        ↓ starts reviewctl review
Isolated reviewers → cross-challenge → independent adjudication
        ↓
Generate .ai-review/reviews/<review-id>/report.md
        ↓
Current session summarizes the report and waits for approval
        ↓
Current session fixes CONFIRMED findings and runs tests
        ↓
reviewctl verify
```

### 1. Install the CLI and skill

Install from npm:

```bash
npm install -g reviewctl
reviewctl setup --target all
```

To test a local tarball before publishing:

```bash
cd /path/to/reviewctl
npm test
npm pack
npm install -g ./reviewctl-0.1.2.tgz
reviewctl setup --target all
```

You can install the skill for only one client:

```bash
reviewctl setup --target codex
reviewctl setup --target claude
```

Restart the Codex or Claude session after installing or updating the skill so
skill discovery is refreshed. Run `reviewctl doctor` to inspect CLI and
authentication status.

### 2. Start a review in the target project

Open the target Git repository in Codex or Claude and enter:

```text
Use $adversarial-project-review to run a multi-model adversarial review of the
current project. Read and summarize the final report, but do not modify code yet.
```

When both Codex and Claude are authenticated, cross-provider review is used by
default. With only one available provider, `reviewctl` creates two isolated
same-provider reviewer roles. The review phase is always read-only.

### 3. Approve and fix in the same session

After reviewing the findings, enter:

```text
Fix every CONFIRMED finding. Recheck the evidence before making minimal changes,
run the relevant tests, then invoke reviewctl verify and report the result.
```

The current version has no `reviewctl fix` command. `reviewctl` automates review,
adjudication, reporting, and read-only verification; code changes remain in the
initiating AI session and require explicit user authorization.

### Skill differences

- `adversarial-project-review` invokes `reviewctl` to run isolated Codex/Claude
  review rounds and produce a resumable ledger and report.
- General review skills such as `project-architecture-review` analyze within the
  current AI session and do not automatically start the multi-model workflow.

When skill descriptions overlap, explicitly request
`$adversarial-project-review` or say “invoke `reviewctl` for a multi-model
adversarial review.”

## Workflow

```bash
cd /path/to/project

reviewctl doctor
reviewctl setup
reviewctl review --scope full --base main --output review-report.md
reviewctl status
reviewctl resume
reviewctl report --output review-report.md
reviewctl verify CODEX-R1-001

# With no finding IDs, verify every CONFIRMED finding.
reviewctl verify --provider codex

# Explicitly choose an executor after reviewing confirmed findings.
# Planned: explicit fix execution after human review.
# reviewctl fix --status confirmed --executor codex --plan-only
```

The review phase is read-only by default. Code changes belong to a separate,
explicitly authorized fix phase.

`reviewctl setup` explicitly installs the bundled `adversarial-project-review`
skill for every detected Codex/Claude CLI. It does not run during npm install and
does not edit provider configuration or credentials. Inspect destinations first
or choose a target:

```bash
reviewctl setup --dry-run
reviewctl setup --target codex
reviewctl setup --target all
reviewctl setup --target shared
```

Provider selection degrades automatically. If both Codex and Claude are
authenticated, each supplies a reviewer. If only one is authenticated, two
isolated sessions from that provider are used. Selection can be explicit:

```bash
reviewctl review --reviewers codex:2 --judge codex
reviewctl review --reviewers codex,claude --judge claude
```

## Design principles

- The event ledger is the source of truth; model sessions are replaceable.
- Reviewers, judges, and executors are separate roles.
- Evidence outweighs model agreement.
- Repository content is untrusted input.
- A single provider degrades gracefully to isolated same-model reviewers.
- Dangerous commands and automatic code changes are denied by default.

See [docs/architecture.md](docs/architecture.md) for the initial module and
lifecycle design.

## Development

Requires Node.js 20 or newer.

```bash
npm install
npm test
npm run eval
```

`npm run eval` validates the deterministic quality scorer without model calls.
To run a real blind case through the current multi-round workflow, explicitly
confirm the model cost:

```bash
npm run eval:live -- --confirm-cost --case stale-lock-race
```

Add `--repeat 3` for stability measurement. Live runs continue after individual case failures and
save structured results under `eval/results/` unless `--output <path>` is supplied.

See [eval/README.md](eval/README.md) for the seven-case baseline, metric definitions,
and full-suite command.

Test the publishable package without publishing it:

```bash
npm pack
mkdir -p /tmp/reviewctl-consumer
npm install --prefix /tmp/reviewctl-consumer ./reviewctl-0.1.2.tgz
/tmp/reviewctl-consumer/node_modules/.bin/reviewctl --help
/tmp/reviewctl-consumer/node_modules/.bin/reviewctl doctor
```

Run a real single-provider smoke test only in a disposable repository that has
no secrets. This performs five model calls (two independent reviews, two
challenges, and one adjudication):

```bash
mkdir -p /tmp/reviewctl-smoke && cd /tmp/reviewctl-smoke
git init
printf 'export const divide = (a, b) => a / b;\n' > index.js
reviewctl doctor
reviewctl review --scope full --reviewers codex:2 --judge codex --timeout-minutes 5
reviewctl status
reviewctl report
```

For cross-provider coverage, authenticate both CLIs and replace the review
command with `reviewctl review --reviewers codex,claude --judge codex`.

## License

MIT
