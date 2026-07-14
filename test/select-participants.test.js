import assert from "node:assert/strict";
import test from "node:test";

import { selectJudge, selectReviewers } from "../dist/index.js";

test("auto mode creates isolated same-provider reviewers when only one is usable", () => {
  const reviewers = selectReviewers(["codex"]);
  assert.deepEqual(reviewers.map((item) => item.provider), ["codex", "codex"]);
  assert.notEqual(reviewers[0].actorId, reviewers[1].actorId);
});

test("explicit cross-provider selection and judge are preserved", () => {
  const reviewers = selectReviewers(["codex", "claude"], "codex,claude");
  const judge = selectJudge(["codex", "claude"], "claude");
  assert.deepEqual(reviewers.map((item) => item.provider), ["codex", "claude"]);
  assert.equal(judge.provider, "claude");
});
