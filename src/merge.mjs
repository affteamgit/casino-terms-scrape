// Merges out/results/shard-*.csv into out/results.csv (one row per input row, ordered by id) and prints a status summary.
// Usage: node src/merge.mjs [resultsDir]
// A casino in several shards keeps its better row (see `better`), so a retry that fails never replaces a local result;
// within one shard its last row stands (see `mergeRows`).
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";

/** How good a row is: 2 = terms read, 1 = reached but no terms, 0 = anything else. */
const rank = (r) => (r.status === "ok" ? (r.terms_found === "yes" ? 2 : 1) : 0);

/** The better of two rows for one casino; on a tie the later row (b) wins, so a retry replaces a local miss. */
export function better(a, b) {
  return rank(b) >= rank(a) ? b : a;
}

/**
 * One row per casino from the shard files, in file order. Within a file a casino's last row is its verdict: a forced
 * rerun replaces what an earlier run (or older code) said there. Across files the better row stands (`better`).
 */
export function mergeRows(files) {
  const byId = new Map();
  for (const rows of files) {
    const last = new Map();
    for (const r of rows) last.set(r.id, r);
    for (const r of last.values()) byId.set(r.id, byId.has(r.id) ? better(byId.get(r.id), r) : r);
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

if (process.argv[1] && process.argv[1].endsWith("merge.mjs")) main();

function main() {
  const dir = process.argv[2] || "out/results";
  const files = [];
  let columns;
  // shard-previous.csv is a previous run's merged results; its rows are kept unless this run redid the casino.
  for (const f of readdirSync(dir, { recursive: true }).map(String).filter((f) => /shard-(\d+|previous)\.csv$/.test(f)).sort((a, b) => (/previous/.test(b) ? 1 : 0) - (/previous/.test(a) ? 1 : 0))) {
    const recs = parse(readFileSync(join(dir, f)), { columns: true, skip_empty_lines: true });
    if (recs.length) columns = [...new Set([...(columns || []), ...Object.keys(recs[0])])];
    files.push(recs);
  }
  // A row retried in a later shard replaces the earlier attempt unless it is worse.
  const merged = mergeRows(files);
  const byId = new Map(merged.map((r) => [r.id, r]));
  mkdirSync("out", { recursive: true });
  writeFileSync("out/results.csv", stringify(merged, { header: true, columns }));
  const tally = {};
  for (const r of merged) tally[r.status] = (tally[r.status] || 0) + 1;
  console.log(`${merged.length} casinos -> out/results.csv`, tally);

  // One job covered every review-site row of that casino: expand the casino results back to one line per input row,
  // so each CasinoGuru / AskGamblers / LCB listing has its data, with its own review URL.
  if (existsSync("input/row-groups.csv") && existsSync("input/casinos.json")) {
    const groups = parse(readFileSync("input/row-groups.csv"), { columns: true, skip_empty_lines: true });
    const casinos = JSON.parse(readFileSync("input/casinos.json", "utf8"));
    const resultByKey = new Map();
    for (const c of casinos) { const r = byId.get(c.start_row); if (r) resultByKey.set(c.key, r); }
    const perRow = groups.map((g) => {
      const r = resultByKey.get(g.key) || { status: "not_run" };
      return { row_id: g.id, source: g.source, casino: g.casino, review_url: g.review_url, listed_domain: g.domain, casino_key: g.key, ...Object.fromEntries(columns.filter((c) => !["id", "source", "casino", "review_url"].includes(c)).map((c) => [c, r[c] ?? ""])) };
    });
    writeFileSync("out/results-by-row.csv", stringify(perRow, { header: true }));
    console.log(`${perRow.length} input rows -> out/results-by-row.csv`);
  }
}
