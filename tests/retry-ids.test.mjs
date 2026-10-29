import { test } from "node:test";
import assert from "node:assert/strict";
import { retryIds } from "../src/retry-ids.mjs";

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
