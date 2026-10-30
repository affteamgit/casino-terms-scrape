// Lists the casinos a local run could not finish, for a Browserless run on Actions: dispatch "Scrape casino terms"
// with only_ids = @input/retry-ids.txt after committing the file.
// Usage: node src/retry-ids.mjs [out/results.csv]  -> input/retry-ids.txt
import { readFileSync, writeFileSync } from "node:fs";
import { parse } from "csv-parse/sync";

/** Not reached, or reached without terms. A casino with no URL, or a parked domain, has nothing to retry. */
export function retryIds(rows) {
  return [...new Set(rows.filter((r) => !["no_url", "parked"].includes(r.status) && (r.status !== "ok" || r.terms_found === "no")).map((r) => r.id))];
}

if (process.argv[1] && process.argv[1].endsWith("retry-ids.mjs")) {
  const file = process.argv[2] || "out/results.csv";
  const rows = parse(readFileSync(file), { columns: true, skip_empty_lines: true });
  if (rows.length && !("id" in rows[0])) throw new Error(`${file} has no id column: pass the per-casino out/results.csv, not results-by-row.csv`);
  const ids = retryIds(rows);
  const retry = new Set(ids);
  writeFileSync("input/retry-ids.txt", ids.join("\n") + "\n");
  const tally = {};
  for (const r of rows) if (retry.has(r.id)) { const k = r.status === "ok" ? "ok/no terms" : r.status; tally[k] = (tally[k] || 0) + 1; }
  console.log(`${ids.length} of ${rows.length} casinos to retry -> input/retry-ids.txt`, tally);
}
