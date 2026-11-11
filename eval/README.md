# Adversarial review evaluation

This directory measures review quality without changing the production review workflow.

Run the deterministic scorer fixture (no model calls or cost):

```bash
npm run eval
```

Run one live blind case through the current multi-round workflow:

```bash
npm run eval:live -- --confirm-cost --case stale-lock-race
```

Use `--repeat 3` to measure run-to-run stability and `--output <path>` to choose the result file.
Without `--output`, live results are saved under ignored `eval/results/`. A failed case is recorded
and does not prevent later cases from running.

Omit `--case` to run all seven cases. A live run makes real provider calls and leaves each temporary
repository in the printed `/tmp` path for inspection. Results are matched by documented semantic
aliases, so the metrics are a repeatable signal rather than a perfect substitute for human review.

Cases declare their provenance with `kind`. `synthetic` cases are deliberately constructed probes;
`historical-regression` cases reproduce a real pre-fix revision and record the fixing commit.

Key metrics:

- `recall`: expected issues confirmed by the final judge.
- `precision`: confirmed findings matching an expected issue.
- `severityAccuracy`: matched findings with the expected severity.
- `cleanCasePassRate`: clean controls with no confirmed findings.
- `duplicateConfirmed`: confirmed findings the judge marked as duplicates.
- `adversarialFalsePositiveDelta`: final false positives minus raw reviewer false positives; negative is better.
