import { test } from "node:test";
import assert from "node:assert/strict";
import { exitLookup, EXIT_REFRESH_MS } from "../src/exit.mjs";

test("exitLookup asks once, shares the call in flight, refreshes after ten minutes and keeps the last good answer", async () => {
  let t = 0, calls = 0, fail = false, release;
  const fetchFn = async () => {
    calls++;
    await new Promise((r) => { release = r; });
    if (fail) throw new Error("quota");
    return { ok: true, json: async () => ({ ip: `10.0.0.${calls}`, country: "NO" }) };
  };
  const where = exitLookup({ fetchFn, now: () => t });
  assert.equal(EXIT_REFRESH_MS, 600000);
  const a = where(), b = where();
  release();
  assert.deepEqual(await a, { ip: "10.0.0.1", ip_country: "NO" });
  assert.deepEqual(await b, { ip: "10.0.0.1", ip_country: "NO" });
  assert.equal(calls, 1, "two callers, one request");
  t += EXIT_REFRESH_MS - 1;
  assert.deepEqual(await where(), { ip: "10.0.0.1", ip_country: "NO" });
  assert.equal(calls, 1, "within ten minutes: no request");
  t += 1;
  const c = where();
  release();
  assert.deepEqual(await c, { ip: "10.0.0.2", ip_country: "NO" });
  assert.equal(calls, 2, "refreshed after ten minutes");
  t += EXIT_REFRESH_MS;
  fail = true;
  const d = where();
  release();
  assert.deepEqual(await d, { ip: "10.0.0.2", ip_country: "NO" }, "a failed refresh keeps the last good answer");
  assert.equal(calls, 3);
  assert.deepEqual(await where(), { ip: "10.0.0.2", ip_country: "NO" });
  assert.equal(calls, 3, "a failure is not retried before the next refresh");
});

test("exitLookup: no answer yet and the lookup fails, or answers badly: blank values, never a throw", async () => {
  assert.deepEqual(await exitLookup({ fetchFn: () => { throw new Error("offline"); }, now: () => 0 })(), { ip: "", ip_country: "" });
  assert.deepEqual(await exitLookup({ fetchFn: async () => ({ ok: false, status: 429 }), now: () => 0 })(), { ip: "", ip_country: "" });
  // a synchronous throw still lets a later refresh run
  let t = 0, n = 0;
  const where = exitLookup({ fetchFn: () => { if (n++ === 0) throw new Error("offline"); return { ok: true, json: async () => ({ ip: "1.2.3.4", country: "SE" }) }; }, now: () => t });
  await where();
  t += EXIT_REFRESH_MS;
  assert.deepEqual(await where(), { ip: "1.2.3.4", ip_country: "SE" });
});
