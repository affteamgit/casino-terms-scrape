// Groups the input rows into casinos. Key: the casino's brand domain (second-level label, TLD and mirror digits
// stripped), taken from AskGamblers' domain column or from the resolved tracking link; rows whose link could not be
// resolved fall back to the normalised name. Writes out/casinos.json (one entry per casino, with every source row),
// out/row-groups.csv (input row -> casino key) and prints the duplicate count.
// Usage: node src/dedupe.mjs
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";

mkdirSync("out", { recursive: true });
const resolved = existsSync("out/resolved.json") ? JSON.parse(readFileSync("out/resolved.json", "utf8")) : {};
const read = (f) => parse(readFileSync(f), { columns: true, skip_empty_lines: true, bom: true });
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; } };

// The brand part of a host: the registrable label, plus any subdomain that is not a functional one (casino.netbet.com
// -> netbet; jeffbet.casino-pp.net -> jeffbet.casinopp, a white-label host). Digits stay: bet25, bet99 and bet365 are
// different casinos. Two-letter second-level suffixes (co.uk, com.au, co.mz) are dropped with the TLD.
const FUNCTIONAL = new Set(["www", "go", "goto", "lp", "promo", "m", "app", "casino", "casinos", "sport", "sports", "play", "join", "start", "get", "vegas", "poker", "bet", "games", "slots", "live", "en", "de", "es", "it", "fr", "pt", "nl", "uk", "us", "ca", "au", "nz", "on", "can", "secure", "affiliates", "aff", "track", "click", "welcome", "bonus", "visit", "try", "register", "signup", "new", "my"]);
export function brandKey(domain) {
  if (!domain) return "";
  let labels = domain.toLowerCase().split(".");
  labels.pop(); // TLD
  if (labels.length > 1 && /^(co|com|net|org|ac|gov|edu)$/.test(labels[labels.length - 1])) labels.pop(); // co.uk, com.au, co.mz
  while (labels.length > 1 && FUNCTIONAL.has(labels[0])) labels.shift();
  return labels.map((l) => l.replace(/[-_]/g, "")).join(".");
}
const normName = (s) => s.toLowerCase().replace(/\b(casino|review|online|the|official|site)\b/g, " ").replace(/[^a-z0-9]/g, "");

const rows = [];
for (const r of read("input/askgamblers_reviews_final.csv")) rows.push({ source: "askgamblers", casino: r.casino_name, review_url: r.review_url, tracking_link: r.tracking_link === "N/A" ? "" : r.tracking_link, domain: host(r.domain_as_on_askgamblers), domain_from: "askgamblers_csv" });
for (const r of read("input/casinoguru_reviews_final.csv")) { const x = resolved[r.tracking_link]; rows.push({ source: "casinoguru", casino: r.casino_name.replace(/\s+Review$/i, ""), review_url: r.final_review_url, tracking_link: r.tracking_link, domain: x && !x.on_tracker ? x.domain : "", domain_from: x && !x.on_tracker ? "tracking_link" : "" }); }
for (const r of read("input/lcb_reviews_final.csv")) { const x = resolved[r.affiliate_url]; rows.push({ source: "lcb", casino: r.casino, review_url: r.review_url, tracking_link: r.affiliate_url, domain: x && !x.on_tracker ? x.domain : "", domain_from: x && !x.on_tracker ? "tracking_link" : "" }); }

// A domain that several differently named casinos land on is an affiliate hub or white-label host
// (number1affiliates.com, inclave.com), not a casino: it cannot be a key, and those rows fall back to their names.
const namesByDomain = new Map();
for (const r of rows) if (r.domain) (namesByDomain.get(r.domain) ?? namesByDomain.set(r.domain, new Set()).get(r.domain)).add(normName(r.casino));
const HUBS = new Set([...namesByDomain].filter(([d, names]) => names.size >= 3 && !d.includes(".", d.indexOf(".") + 1) /* keep subdomain-keyed white labels */).map(([d]) => d));
for (const r of rows) if (HUBS.has(r.domain)) { r.hub = r.domain; r.domain = ""; r.domain_from = ""; }

// Affiliate landing hosts carry a prefix or mirror digit on the brand (gotobitstarz.com, joinstake.com, bangawin1.com):
// when the rest of the key is a brand seen on its own, the row belongs to that brand.
const allKeys = new Set(rows.map((r) => brandKey(r.domain)).filter(Boolean));
const PREFIXES = /^(goto|go|get|join|play|start|visit|try|promo|lp|track|click|bonus|welcome)/;
const canon = (k) => {
  const m = k.match(PREFIXES);
  if (m) { const rest = k.slice(m[0].length); if (rest.length >= 4 && allKeys.has(rest)) return rest; }
  const base = k.replace(/\d{1,2}$/, "");
  if (base !== k && base.length >= 4 && allKeys.has(base)) return base;
  return k;
};

// Names seen for each brand key, so an unresolved row can still join its casino by name.
const keyByName = new Map();
for (const r of rows) { const k = canon(brandKey(r.domain)); if (k) keyByName.set(normName(r.casino), k); }

const groups = new Map();
rows.forEach((r, i) => {
  r.id = `${r.source}-${String(i + 1).padStart(5, "0")}`;
  let key = canon(brandKey(r.domain)), keyed_by = key ? "domain" : "";
  if (!key) { key = keyByName.get(normName(r.casino)) || ""; keyed_by = key ? "name->domain" : ""; }
  if (!key) { key = "name:" + normName(r.casino); keyed_by = "name"; }
  r.key = key; r.keyed_by = keyed_by;
  if (!groups.has(key)) groups.set(key, { key, casino: r.casino, domains: new Set(), sources: new Set(), rows: [] });
  const g = groups.get(key);
  if (r.domain) g.domains.add(r.domain);
  g.sources.add(r.source);
  g.rows.push(r);
});

const casinos = [...groups.values()].map((g) => {
  // Start URL: a tracking link first (casino.guru, then askgamblers, then lcb), else the known domain.
  const pick = (src) => g.rows.find((r) => r.source === src && r.tracking_link);
  const t = pick("casinoguru") || pick("askgamblers") || pick("lcb");
  const domain = [...g.domains][0] || "";
  return { key: g.key, casino: g.casino, domains: [...g.domains], sources: [...g.sources], row_count: g.rows.length, start_url: t ? t.tracking_link : domain ? `https://${domain}/` : "", start_type: t ? "tracking" : domain ? "domain" : "none", start_row: t ? t.id : g.rows[0].id, rows: g.rows.map((r) => r.id) };
});
writeFileSync("out/casinos.json", JSON.stringify(casinos, null, 1));
writeFileSync("out/row-groups.csv", stringify(rows.map((r) => ({ id: r.id, source: r.source, casino: r.casino, review_url: r.review_url, domain: r.domain, key: r.key, keyed_by: r.keyed_by })), { header: true }));

const by = (f) => rows.filter(f).length;
console.log(`${rows.length} rows -> ${casinos.length} casinos (${rows.length - casinos.length} duplicates removed)`);
console.log(`keyed by domain: ${by((r) => r.keyed_by === "domain")}, by name matched to a domain: ${by((r) => r.keyed_by === "name->domain")}, by name only: ${by((r) => r.keyed_by === "name")}`);
console.log(`casinos on 3 sites: ${casinos.filter((c) => c.sources.length === 3).length}, on 2: ${casinos.filter((c) => c.sources.length === 2).length}, on 1: ${casinos.filter((c) => c.sources.length === 1).length}`);
console.log(`start via tracking link: ${casinos.filter((c) => c.start_type === "tracking").length}, via domain: ${casinos.filter((c) => c.start_type === "domain").length}, none: ${casinos.filter((c) => c.start_type === "none").length}`);
