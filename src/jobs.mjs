// Builds out/jobs.json from the three review-site CSVs: one job per input row, duplicates kept.
// The start URL is the tracking link; when it is N/A or malformed, the casino's own domain is used instead.
// Usage: node src/jobs.mjs [--limit-per-source N]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { parse } from "csv-parse/sync";

const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const limit = Number(arg("--limit-per-source") || 0);

const read = (f) => parse(readFileSync(f), { columns: true, skip_empty_lines: true, bom: true });
const validUrl = (u) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) && /\.[a-z]{2,}$/i.test(x.hostname); } catch { return false; } };

const sources = [
  { source: "askgamblers", file: "input/askgamblers_reviews_final.csv", map: (r) => ({ casino: r.casino_name, review_url: r.review_url, tracking: r.tracking_link, domain: r.domain_as_on_askgamblers }) },
  { source: "casinoguru", file: "input/casinoguru_reviews_final.csv", map: (r) => ({ casino: r.casino_name.replace(/\s+Review$/i, ""), review_url: r.final_review_url, tracking: r.tracking_link, domain: "" }) },
  { source: "lcb", file: "input/lcb_reviews_final.csv", map: (r) => ({ casino: r.casino, review_url: r.review_url, tracking: r.affiliate_url, domain: "" }) },
];

const jobs = [];
for (const s of sources) {
  let rows = read(s.file).map(s.map);
  if (limit) rows = rows.slice(0, limit);
  rows.forEach((r, i) => {
    const trackingOk = r.tracking && r.tracking.toUpperCase() !== "N/A" && validUrl(r.tracking);
    const domainOk = r.domain && validUrl(r.domain);
    jobs.push({
      id: `${s.source}-${String(i + 1).padStart(5, "0")}`,
      source: s.source,
      casino: r.casino,
      review_url: r.review_url,
      tracking_link: r.tracking || "",
      domain: r.domain || "",
      start_url: trackingOk ? r.tracking : domainOk ? r.domain : "",
      start_type: trackingOk ? "tracking" : domainOk ? "domain" : "none",
    });
  });
}
mkdirSync("out", { recursive: true });
writeFileSync("out/jobs.json", JSON.stringify(jobs, null, 1));
const count = (k) => jobs.filter((j) => j.start_type === k).length;
console.log(`${jobs.length} jobs: ${count("tracking")} via tracking link, ${count("domain")} via domain, ${count("none")} with no usable URL`);
