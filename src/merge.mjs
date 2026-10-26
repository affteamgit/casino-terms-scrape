// Merges out/results/shard-*.csv into out/results.csv (one row per input row, ordered by id) and prints a status summary.
// Usage: node src/merge.mjs [resultsDir]
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";

const dir = process.argv[2] || "out/results";
const rows = [];
let columns;
for (const f of readdirSync(dir, { recursive: true }).map(String).filter((f) => /shard-\d+\.csv$/.test(f))) {
  const recs = parse(readFileSync(join(dir, f)), { columns: true, skip_empty_lines: true });
  if (recs.length) columns ??= Object.keys(recs[0]);
  rows.push(...recs);
}
// A row retried later replaces the earlier attempt.
const byId = new Map();
for (const r of rows) byId.set(r.id, r);
const merged = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
mkdirSync("out", { recursive: true });
writeFileSync("out/results.csv", stringify(merged, { header: true, columns }));
const tally = {};
for (const r of merged) tally[r.status] = (tally[r.status] || 0) + 1;
console.log(`${merged.length} rows -> out/results.csv`, tally);
