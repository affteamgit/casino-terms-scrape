import { test } from "node:test";
import assert from "node:assert/strict";
import { better } from "../src/merge.mjs";

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
