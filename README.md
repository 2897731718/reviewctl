# reviewctl

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

Agent processes receive a provider-specific environment allowlist instead of
the caller's complete environment. Codex review sessions also ignore local
rules and user configuration, run read-only, and do not pass CLI credentials
into model-invoked shell commands. Stored model output and errors have known
credential values and common token shapes redacted before schema validation,
ledger writes, snapshots, and report generation.

## 推荐用法：在同一个 AI 窗口中评审和修复

`reviewctl` 的主要入口不是让用户手动组织每一个模型，而是让当前的
Codex 或 Claude 窗口作为发起者。当前窗口调用 `reviewctl` 启动相互隔离的
评审者和裁决者，等待报告生成，读取并向用户汇总结论；用户确认后，再由
当前窗口修复代码并调用 `reviewctl verify` 复核。

```text
当前 Codex / Claude 窗口
        ↓ 发起 reviewctl review
隔离评审者 → 交叉质疑 → 独立裁决
        ↓
生成 .ai-review/reviews/<review-id>/report.md
        ↓
当前窗口反馈报告，等待用户确认
        ↓
当前窗口修复 CONFIRMED 问题并运行测试
        ↓
reviewctl verify
```

### 1. 安装 CLI 和 Skill

从 npm 安装（发布后）：

```bash
npm install -g reviewctl
reviewctl setup --target all
```

在发布前使用本地 tarball 测试：

```bash
cd /path/to/reviewctl
npm test
npm pack
npm install -g ./reviewctl-0.1.0.tgz
reviewctl setup --target all
```

也可以只安装一个客户端的 Skill：

```bash
reviewctl setup --target codex
reviewctl setup --target claude
```

安装或更新 Skill 后，需要重新打开 Codex/Claude 会话以刷新 Skill 发现。
使用 `reviewctl doctor` 检查 CLI 和认证状态。支持 CLI 登录，以及环境变量
`OPENAI_API_KEY`、`ANTHROPIC_API_KEY` 和 `ANTHROPIC_AUTH_TOKEN`；环境变量只
检查是否非空，真实有效性需要通过实际模型调用确认。

### 2. 在目标项目中发起评审

进入目标 Git 仓库并打开 Codex 或 Claude。在当前 AI 窗口输入：

```text
使用 $adversarial-project-review 对当前项目进行多模型对抗评审。
完成后读取最终报告并在当前窗口汇总，暂时不要修改代码。
```

也可以明确要求 AI 调用 `reviewctl`：

```text
调用 reviewctl 对当前项目执行完整对抗评审。等待命令完成，读取 report.md，
区分 CONFIRMED、DISPUTED、WITHDRAWN 和 UNVERIFIED，并先向我反馈，不要修改代码。
```

如果 Codex 和 Claude 都已认证，默认使用跨模型评审；如果只有一个可用，
`reviewctl` 会创建两个隔离的同模型评审角色。评审阶段始终只读。

### 3. 在同一窗口确认并执行修复

查看当前窗口反馈的结论后，用户可以继续输入：

```text
修复报告中所有 CONFIRMED 问题。修改前重新验证证据，保持最小改动，
运行相关测试，完成后调用 reviewctl verify 复核并向我汇报结果。
```

当前版本没有 `reviewctl fix` 命令。`reviewctl` 自动负责评审、裁决、报告和
只读复核；代码修改由发起评审的当前 AI 窗口在用户明确授权后执行。这使
评审与写代码保持权限隔离，同时不需要切换聊天窗口。

### Skill 的区别

- `adversarial-project-review`：调用 `reviewctl` 启动隔离的 Codex/Claude
  多轮评审，生成可恢复的账本和报告。
- `project-architecture-review` 等普通评审 Skill：由当前 AI 自己分析，
  不会自动启动多模型对抗流程。

当多个评审 Skill 的触发描述相近时，显式写
`$adversarial-project-review` 或“调用 `reviewctl` 进行多模型对抗评审”。

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
```

Test the publishable package without publishing it:

```bash
npm pack
mkdir -p /tmp/reviewctl-consumer
npm install --prefix /tmp/reviewctl-consumer ./reviewctl-0.1.0.tgz
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
