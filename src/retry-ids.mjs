// Lists the casinos a local run could not finish, for a Browserless run on Actions: dispatch "Scrape casino terms"
// with only_ids = @input/retry-ids.txt after committing the file.
// Usage: node src/retry-ids.mjs [out/results.csv]  -> input/retry-ids.txt
import { readFileSync, writeFileSync } from "node:fs";
import { parse } from "csv-parse/sync";

/** Reached and classified: a casino with no URL, a parked domain, a closed site or a non-casino has nothing to retry. */
const NOTHING_TO_RETRY = ["no_url", "parked", "closed", "not_casino"];

/**
 * Why a casino is worth another run, or "" when it is not: Jev did not judge it ("jev-failed", whether or not terms were
 * found), it was reached without terms ("ok/no terms"), or it was not reached (its status).
 */
export function retryReason(r) {
  if (NOTHING_TO_RETRY.includes(r.status)) return "";
  if (r.status === "ok" && /error:/.test(r.jev || "")) return "jev-failed";
  if (r.status !== "ok") return r.status;
  return r.terms_found === "no" ? "ok/no terms" : "";
}

export function retryIds(rows) {
  return [...new Set(rows.filter((r) => retryReason(r)).map((r) => r.id))];
}

if (process.argv[1] && process.argv[1].endsWith("retry-ids.mjs")) {
  const file = process.argv[2] || "out/results.csv";
  const rows = parse(readFileSync(file), { columns: true, skip_empty_lines: true });
  if (rows.length && !("id" in rows[0])) throw new Error(`${file} has no id column: pass the per-casino out/results.csv, not results-by-row.csv`);
  const ids = retryIds(rows);
  writeFileSync("input/retry-ids.txt", ids.join("\n") + "\n");
  const tally = {};
  for (const r of rows) { const k = retryReason(r); if (k) tally[k] = (tally[k] || 0) + 1; }
  console.log(`${ids.length} of ${rows.length} casinos to retry -> input/retry-ids.txt`, tally);
}
