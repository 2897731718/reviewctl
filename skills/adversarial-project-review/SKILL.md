---
name: adversarial-project-review
description: Start and control evidence-driven adversarial project reviews with the reviewctl CLI. Use when the user asks an AI to review requirements, architecture, implementation, security, reliability, or tests through isolated Codex/Claude reviewers; asks to run, resume, inspect, report, or verify a reviewctl review; or asks the current AI to trigger a multi-agent review and summarize its report. Do not invoke reviewctl from an assigned review phase such as independent_review, cross_challenge, adjudication, or verification.
---

# Adversarial Project Review

Use `reviewctl` as the orchestrator. Treat the current AI as the review initiator, not as one
of the isolated reviewers.

## Guard against recursion

If the current prompt assigns `phase=independent_review`, `phase=cross_challenge`,
`phase=adjudication`, or `phase=verification`, complete that phase directly and do not run
`reviewctl`. The orchestrator already created this isolated session.

## Start a review

1. Work from the target Git repository.
2. Run `reviewctl doctor`.
3. If no authenticated provider is available, report the remediation and stop.
4. Run the smallest review matching the user's request:

```bash
reviewctl review --scope architecture --spec docs/architecture.md
reviewctl review --scope implementation --base main
reviewctl review --scope full --base main
```

Use automatic provider selection unless the user specifies reviewers or a judge. A single
authenticated provider is valid; reviewctl creates isolated same-provider roles.

## Handle lifecycle commands

- Inspect recent runs with `reviewctl status`.
- Resume an interrupted run with `reviewctl resume [review-id]`.
- Rebuild a report with `reviewctl report [review-id] [--output path]`.
- Re-check confirmed findings after code changes with
  `reviewctl verify [finding-id...] [--review review-id] [--provider provider]`.

Do not manually edit `.ai-review` ledger files.

## Present the result

Read the generated `report.md` and lead with P0/P1 findings. Distinguish
`CONFIRMED`, `DISPUTED`, `WITHDRAWN`, and `UNVERIFIED`. Cite repository paths and
verification evidence. State when a same-provider review has weaker independence than a
cross-provider review.

The review workflow is read-only. Never modify code, commit, push, or start a fix workflow
unless the user explicitly requests and authorizes that separate action.

If `reviewctl` is not on `PATH`, explain that it must be installed or linked. Do not fetch and
execute an unpinned package implicitly.
