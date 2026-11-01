import { test } from "node:test";
import assert from "node:assert/strict";
import { retryIds, retryReason } from "../src/retry-ids.mjs";

test("retryIds: every casino not reached, and every reached one without terms", () => {
  const rows = [
    { id: "a", status: "ok", terms_found: "yes" },
    { id: "b", status: "ok", terms_found: "no" },
    { id: "c", status: "geo_blocked", terms_found: "" },
    { id: "d", status: "timeout", terms_found: "" },
    { id: "e", status: "no_url", terms_found: "" },
    { id: "f", status: "parked", terms_found: "" },
  ];
  assert.deepEqual(retryIds(rows), ["b", "c", "d"]);
});

test("retryIds: parked, closed and not_casino rows are terminal; an ok row whose Jev call failed is listed whatever the terms (jev-failed)", () => {
  const rows = [
    { id: "a", status: "closed", terms_found: "" },
    { id: "b", status: "not_casino", terms_found: "" },
    { id: "c", status: "parked", terms_found: "" },
    { id: "d", status: "ok", terms_found: "yes", jev: "links:3 error:jev http 529" },
    { id: "e", status: "ok", terms_found: "no", jev: "error:jev http 529" },
    { id: "f", status: "ok", terms_found: "yes", jev: "links:3 page:yes:0.97" },
    { id: "g", status: "ok", terms_found: "yes", jev: "off" },
    { id: "h", status: "closed", terms_found: "", jev: "error:jev http 529" },
  ];
  assert.deepEqual(retryIds(rows), ["d", "e"]);
  assert.deepEqual(rows.map(retryReason), ["", "", "", "jev-failed", "jev-failed", "", "", ""]);
  assert.equal(retryReason({ id: "x", status: "ok", terms_found: "no", jev: "off" }), "ok/no terms");
  assert.equal(retryReason({ id: "x", status: "timeout" }), "timeout");
});
