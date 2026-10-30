import { test } from "node:test";
import assert from "node:assert/strict";
import { better, mergeRows } from "../src/merge.mjs";

const row = (id, status, terms_found, tag) => ({ id, status, terms_found, tag });

test("better: a later ok with terms beats an earlier ok without", () => {
  assert.equal(better(row("a", "ok", "no", "local"), row("a", "ok", "yes", "retry")).tag, "retry");
});
test("better: an earlier ok without terms beats a later failure", () => {
  assert.equal(better(row("a", "ok", "no", "local"), row("a", "dead_or_empty", "", "retry")).tag, "local");
});
test("better: within a rank the later row wins", () => {
  assert.equal(better(row("a", "ok", "yes", "local"), row("a", "ok", "yes", "retry")).tag, "retry");
  assert.equal(better(row("a", "blocked_http", "", "local"), row("a", "timeout", "", "retry")).tag, "retry");
});
test("better: parked against ok without terms keeps the ok", () => {
  assert.equal(better(row("a", "ok", "no", "local"), row("a", "parked", "", "retry")).tag, "local");
  assert.equal(better(row("a", "parked", "", "local"), row("a", "ok", "no", "retry")).tag, "retry");
});

test("mergeRows: within one shard the last row is the verdict; across shards the better row stands", () => {
  // a --force rerun in the same shard replaces an earlier verdict made by older code (megafrenzy's false 'yes')
  const same = mergeRows([[row("a", "ok", "yes", "old"), row("b", "ok", "no", "old"), row("a", "parked", "", "new"), row("b", "ok", "yes", "new")]]);
  assert.deepEqual(same.map((r) => `${r.id}:${r.tag}`), ["a:new", "b:new"]);
  // a later shard (a Browserless retry) that fails does not replace the local result; one that finds terms does
  const across = mergeRows([[row("a", "ok", "no", "local"), row("b", "ok", "no", "local")], [row("a", "dead_or_empty", "", "retry"), row("b", "ok", "yes", "retry")]]);
  assert.deepEqual(across.map((r) => `${r.id}:${r.tag}`), ["a:local", "b:retry"]);
});
