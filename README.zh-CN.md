# reviewctl

[English](README.md) | [简体中文](README.zh-CN.md)

面向 AI 编程智能体、以证据为核心的多轮对抗评审工具。

`reviewctl` 是一个本地优先的 CLI。它负责协调相互隔离的 Codex 和 Claude
会话，将证据保存到可恢复的事件账本，并生成最终评审报告。它既支持跨模型
评审，也支持仅用一个 provider 创建多个隔离的评审角色。

## 安装

需要 Node.js 20 或更高版本，并至少安装、登录 Codex CLI 或 Claude Code CLI。

```bash
npm install -g reviewctl
reviewctl setup --target all
reviewctl doctor
```

安装或更新 Skill 后，需要重新打开 Codex/Claude 会话以刷新 Skill 发现。

认证检测支持 CLI 已保存的登录状态，以及环境变量 `OPENAI_API_KEY`、
`ANTHROPIC_API_KEY` 或 `ANTHROPIC_AUTH_TOKEN`。环境变量值不会被记录或持久化。

## Claude 兼容 API 网关

使用 ccapi 等 Claude 兼容网关时，需要让 `reviewctl` 进程直接获得相关变量，
以便其启动的 `claude` 子进程继承：

```bash
export ANTHROPIC_AUTH_TOKEN="..."
export ANTHROPIC_BASE_URL="https://gateway.example.com"
export ANTHROPIC_MODEL="claude-model-name"
reviewctl doctor
reviewctl review --scope implementation --base HEAD
```

也可以只为单次命令设置：

```bash
ANTHROPIC_AUTH_TOKEN="..." \
ANTHROPIC_BASE_URL="https://gateway.example.com" \
ANTHROPIC_MODEL="claude-model-name" \
reviewctl review --scope implementation --base HEAD
```

仅在 shell alias 内启动 `claude` 时设置变量，`reviewctl` 无法继承这些配置。

## 推荐流程：在同一个 AI 窗口中评审和修复

```text
当前 Codex / Claude 窗口
        ↓ 发起 reviewctl review
隔离评审者 → 交叉质疑 → 独立裁决
        ↓
生成 .ai-review/reviews/<review-id>/report.md
        ↓
当前窗口汇总报告，等待用户确认
        ↓
当前窗口修复 CONFIRMED 问题并运行测试
        ↓
reviewctl verify
```

在目标 Git 仓库中，可以对当前 AI 输入：

```text
使用 $adversarial-project-review 对当前项目进行多模型对抗评审。
完成后读取最终报告并在当前窗口汇总，暂时不要修改代码。
```

如果 Codex 和 Claude 都已认证，默认使用跨模型评审；如果只有一个可用，
`reviewctl` 会创建两个隔离的同模型评审角色。评审阶段始终只读。

确认报告后继续输入：

```text
修复报告中所有 CONFIRMED 问题。修改前重新验证证据，保持最小改动，
运行相关测试，完成后调用 reviewctl verify 复核并向我汇报结果。
```

当前版本没有 `reviewctl fix` 命令。代码修改仍由发起评审的 AI 窗口在用户
明确授权后执行，`reviewctl` 负责评审、裁决、报告和只读复核。

## CLI 使用

```bash
cd /path/to/project

reviewctl doctor
reviewctl setup
reviewctl review --scope full --base main --output review-report.md
reviewctl status
reviewctl resume
reviewctl report --output review-report.md
reviewctl verify CODEX-R1-001

# 不传 finding ID 时，复核所有 CONFIRMED 问题。
reviewctl verify --provider codex
```

手动指定评审者和裁决者：

```bash
reviewctl review --reviewers codex:2 --judge codex
reviewctl review --reviewers codex,claude --judge claude
```

安装 Skill 前查看目标位置，或只安装到指定客户端：

```bash
reviewctl setup --dry-run
reviewctl setup --target codex
reviewctl setup --target claude
reviewctl setup --target all
reviewctl setup --target shared
```

## 设计原则

- 事件账本是事实来源，模型会话可以替换。
- 评审者、裁决者和执行者相互独立。
- 证据优先于模型之间的一致意见。
- 仓库内容属于不可信输入。
- 只有一个 provider 时，平滑降级为隔离的同模型评审者。
- 默认禁止危险命令和自动代码修改。

架构和生命周期设计见 [docs/architecture.md](docs/architecture.md)。

## 开发与自测

```bash
npm install
npm test
npm run eval
```

`npm run eval` 不调用模型，只验证确定性的质量评分器。真实盲测需要明确确认
模型调用成本：

```bash
npm run eval:live -- --confirm-cost --case stale-lock-race
```

增加 `--repeat 3` 可测量稳定性。评测结果默认保存在 `eval/results/`。
七用例基线和指标定义见 [eval/README.md](eval/README.md)。

测试本地待发布包：

```bash
npm test
npm pack
npm install -g ./reviewctl-0.1.2.tgz
reviewctl --version
reviewctl doctor
```
