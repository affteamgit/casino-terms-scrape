// Builds out/jobs.json: one job per casino from input/casinos.json (built by src/dedupe.mjs, duplicates across the
// three review sites merged), or, when that file is absent, one job per CSV row. The start URL is the tracking link
// where there is one, else the casino's domain.
// Usage: node src/jobs.mjs [--limit-per-source N] [--per-row]
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { parse } from "csv-parse/sync";

const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const limit = Number(arg("--limit-per-source") || 0);
const perRow = process.argv.includes("--per-row") || !existsSync("input/casinos.json");

const read = (f) => parse(readFileSync(f), { columns: true, skip_empty_lines: true, bom: true });
const validUrl = (u) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) && /\.[a-z]{2,}$/i.test(x.hostname); } catch { return false; } };

let jobs = [];
if (perRow) {
  const sources = [
    { source: "askgamblers", file: "input/askgamblers_reviews_final.csv", map: (r) => ({ casino: r.casino_name, review_url: r.review_url, tracking: r.tracking_link, domain: r.domain_as_on_askgamblers }) },
    { source: "casinoguru", file: "input/casinoguru_reviews_final.csv", map: (r) => ({ casino: r.casino_name.replace(/\s+Review$/i, ""), review_url: r.final_review_url, tracking: r.tracking_link, domain: "" }) },
    { source: "lcb", file: "input/lcb_reviews_final.csv", map: (r) => ({ casino: r.casino, review_url: r.review_url, tracking: r.affiliate_url, domain: "" }) },
  ];
  for (const s of sources) {
    let rows = read(s.file).map(s.map);
    if (limit) rows = rows.slice(0, limit);
    rows.forEach((r, i) => {
      const trackingOk = r.tracking && r.tracking.toUpperCase() !== "N/A" && validUrl(r.tracking);
      const domainOk = r.domain && validUrl(r.domain);
      jobs.push({ id: `${s.source}-${String(i + 1).padStart(5, "0")}`, source: s.source, casino: r.casino, review_url: r.review_url, tracking_link: r.tracking || "", domain: r.domain || "", start_url: trackingOk ? r.tracking : domainOk ? r.domain : "", start_type: trackingOk ? "tracking" : domainOk ? "domain" : "none" });
    });
  }
} else {
  const casinos = JSON.parse(readFileSync("input/casinos.json", "utf8"));
  // --limit-per-source N keeps the first N casinos that have a row on each source (so a pilot still covers all three).
  const picked = limit ? ["askgamblers", "casinoguru", "lcb"].flatMap((s) => casinos.filter((c) => c.sources.includes(s)).slice(0, limit)) : casinos;
  const seen = new Set();
  for (const c of picked) {
    if (seen.has(c.key)) continue;
    seen.add(c.key);
    const domain = c.domains[0] ? `https://${c.domains[0]}/` : "";
    jobs.push({ id: c.start_row, key: c.key, source: c.sources.join("+"), casino: c.casino, review_url: "", tracking_link: c.start_type === "tracking" ? c.start_url : "", domain, start_url: c.start_url, start_type: c.start_type, rows: c.rows });
  }
}
mkdirSync("out", { recursive: true });
writeFileSync("out/jobs.json", JSON.stringify(jobs, null, 1));
const count = (k) => jobs.filter((j) => j.start_type === k).length;
console.log(`${jobs.length} jobs (${perRow ? "one per row" : "one per casino"}): ${count("tracking")} via tracking link, ${count("domain")} via domain, ${count("none")} with no usable URL`);
