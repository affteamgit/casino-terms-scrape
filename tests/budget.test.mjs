import { test } from "node:test";
import assert from "node:assert/strict";
import { sessions, withBudget } from "../src/budget.mjs";

const fakeBrowser = () => { const b = { closed: 0, close: async () => { b.closed++; } }; return b; };

test("withBudget: a casino past its budget is a timeout row, and the browser it registered is closed", async () => {
  const live = sessions();
  const b = fakeBrowser();
  const hung = (async () => { await live.add("j1", b); await new Promise(() => {}); })(); // an attempt that never resolves
  const row = await withBudget("j1", hung, 50, live, () => ({ status: "timeout" }));
  assert.equal(row.status, "timeout");
  assert.equal(b.closed, 1, "the timeout branch closed the registered browser");
  assert.equal(live.ended("j1"), true);
  // the timed-out casino's run goes on in the background: a browser it opens next is closed at once
  const b2 = fakeBrowser();
  await assert.rejects(live.add("j1", b2), /timed out/);
  assert.equal(b2.closed, 1);
});

test("withBudget: a casino within its budget returns its row and closes nothing", async () => {
  const live = sessions();
  const b = fakeBrowser();
  const work = (async () => { await live.add("j2", b); try { return { status: "ok" }; } finally { live.remove("j2", b); } })();
  const row = await withBudget("j2", work, 1000, live, () => ({ status: "timeout" }));
  assert.equal(row.status, "ok");
  assert.equal(b.closed, 0);
  assert.equal(live.ended("j2"), false);
  // a browser that fails to close does not fail the timeout branch
  const stuck = { close: async () => { throw new Error("gone"); } };
  const row2 = await withBudget("j3", (async () => { await live.add("j3", stuck); await new Promise(() => {}); })(), 20, live, () => ({ status: "timeout" }));
  assert.equal(row2.status, "timeout");
});
