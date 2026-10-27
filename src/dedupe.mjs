// Groups the input rows into casinos. A row's domain comes from AskGamblers' domain column or from the resolved
// tracking link (input/resolved.json, built by src/resolve.mjs); rows whose link could not be resolved fall back to
// the normalised name. Writes out/casinos.json (one entry per casino, with every source row), out/row-groups.csv
// (input row -> casino key) and prints the duplicate count.
// Usage: node src/dedupe.mjs
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";

mkdirSync("out", { recursive: true });
const RESOLVED = ["input/resolved.json", "out/resolved.json"].find(existsSync);
const resolved = RESOLVED ? JSON.parse(readFileSync(RESOLVED, "utf8")) : {};
const read = (f) => parse(readFileSync(f), { columns: true, skip_empty_lines: true, bom: true });
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; } };

// A domain splits into its brand part and its TLD part. The brand is the registrable label plus any subdomain that is
// not a functional one (casino.netbet.com -> netbet; jeffbet.casino-pp.net -> jeffbet.casinopp, a white-label host).
// Digits stay: bet25, bet99 and bet365 are different casinos. Two-letter second-level suffixes (co.uk, com.au, co.mz)
// belong to the TLD part.
const FUNCTIONAL = new Set(["www", "go", "goto", "lp", "promo", "m", "app", "casino", "casinos", "sport", "sports", "play", "join", "start", "get", "vegas", "poker", "bet", "games", "slots", "live", "en", "de", "es", "it", "fr", "pt", "nl", "uk", "us", "ca", "au", "nz", "on", "can", "secure", "affiliates", "aff", "track", "click", "welcome", "bonus", "visit", "try", "register", "signup", "new", "my", "record"]);
export function splitDomain(domain) {
  if (!domain) return { brand: "", tld: "" };
  const labels = domain.toLowerCase().split(".");
  const tld = [labels.pop()];
  if (labels.length > 1 && /^(co|com|net|org|ac|gov|edu)$/.test(labels[labels.length - 1])) tld.unshift(labels.pop());
  while (labels.length > 1 && FUNCTIONAL.has(labels[0])) labels.shift();
  return { brand: labels.map((l) => l.replace(/[-_]/g, "")).join("."), tld: tld.join(".") };
}
export const brandKey = (domain) => splitDomain(domain).brand;
const rawKey = (domain) => { const { brand, tld } = splitDomain(domain); return brand ? `${brand}.${tld}` : ""; };
const normName = (s) => s.toLowerCase().replace(/\b(casino|review|online|the|official|site)\b/g, " ").replace(/[^a-z0-9]/g, "");

const rows = [];
for (const r of read("input/askgamblers_reviews_final.csv")) rows.push({ source: "askgamblers", casino: r.casino_name, review_url: r.review_url, tracking_link: r.tracking_link === "N/A" ? "" : r.tracking_link, domain: host(r.domain_as_on_askgamblers), domain_from: "askgamblers_csv" });
for (const r of read("input/casinoguru_reviews_final.csv")) { const x = resolved[r.tracking_link]; rows.push({ source: "casinoguru", casino: r.casino_name.replace(/\s+Review$/i, ""), review_url: r.final_review_url, tracking_link: r.tracking_link, domain: x && !x.on_tracker ? x.domain : "", domain_from: x && !x.on_tracker ? "tracking_link" : "" }); }
for (const r of read("input/lcb_reviews_final.csv")) { const x = resolved[r.affiliate_url]; rows.push({ source: "lcb", casino: r.casino, review_url: r.review_url, tracking_link: r.affiliate_url, domain: x && !x.on_tracker ? x.domain : "", domain_from: x && !x.on_tracker ? "tracking_link" : "" }); }

// A host that casinos with unrelated names land on is an affiliate tracker, a white-label host or a government block
// page (promo.globeaffiliates.com, brasilsembets.gov.br), or a casino that closed brands now redirect to (nalucasino.io
// for Charles and DealBet). Such rows fall back to their names: each keeps its own tracking link, which a real browser
// may still take somewhere else. Rows whose name matches the domain's brand (betvictor.com: BetVictor, BetVictor UK)
// keep the domain. A host with a brand subdomain (jeffbet.casino-pp.net) is a casino and is kept.
const related = (name, domain) => { const core = splitDomain(domain).brand.split(".").pop(); return name === core || (name.length >= 3 && (name.includes(core) || core.includes(name))); };
const namesByDomain = new Map();
for (const r of rows) if (r.domain) (namesByDomain.get(r.domain) ?? namesByDomain.set(r.domain, new Set()).get(r.domain)).add(normName(r.casino));
const HUBS = new Set([...namesByDomain].filter(([d, names]) => names.size >= 3 && !splitDomain(d).brand.includes(".") && [...names].filter((n) => !related(n, d)).length >= 2).map(([d]) => d));
for (const r of rows) if (HUBS.has(r.domain) && !related(normName(r.casino), r.domain)) { r.hub = r.domain; r.domain = ""; r.domain_from = ""; }

// Variant domains of one casino: an affiliate prefix (gotobitstarz.com), a mirror digit (andromedasino21.com) or
// another TLD (playuzu.es). Such a domain joins the brand it varies from only when the two also share a casino name,
// so slots52.com stays apart from slots.com and stake.us from stake.com. A base that is a bare gambling word never
// attracts variants: wild7.bet is not wild.io.
const GENERIC = new Set(["casino", "casinos", "slots", "slot", "bet", "bets", "betting", "spin", "spins", "lucky", "luck", "wild", "win", "wins", "winner", "jackpot", "vegas", "play", "games", "game", "poker", "bingo", "royal", "king", "star", "gold", "lotto", "fortune", "cash", "money", "crypto", "bitcoin", "ace", "joker", "roulette", "dice", "sport", "sports", "7", "21", "777"]);
const PREFIXES = /^(goto|go|get|join|play|start|visit|try|promo|lp|track|click|bonus|welcome)/;
const brands = new Set(rows.map((r) => splitDomain(r.domain).brand).filter(Boolean));
const baseBrand = (brand) => {
  const m = brand.match(PREFIXES);
  if (m) { const rest = brand.slice(m[0].length); if (rest.length >= 4 && brands.has(rest) && !GENERIC.has(rest)) return rest; }
  const base = brand.replace(/\d{1,2}$/, "");
  if (base !== brand && base.length >= 4 && brands.has(base) && !GENERIC.has(base)) return base;
  return brand;
};
const namesByRaw = new Map();
for (const r of rows) if (r.domain) (namesByRaw.get(rawKey(r.domain)) ?? namesByRaw.set(rawKey(r.domain), new Set()).get(rawKey(r.domain))).add(normName(r.casino));
const clusters = new Map(); // base brand -> raw keys that could be the same casino
for (const k of namesByRaw.keys()) { const b = baseBrand(k.slice(0, k.lastIndexOf("."))); (clusters.get(b) ?? clusters.set(b, []).get(b)).push(k); }
const parent = new Map([...namesByRaw.keys()].map((k) => [k, k]));
const find = (k) => (parent.get(k) === k ? k : (parent.set(k, find(parent.get(k))), parent.get(k)));
const shareName = (a, b) => [...namesByRaw.get(a)].some((n) => namesByRaw.get(b).has(n));
for (const keys of clusters.values()) for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) if (shareName(keys[i], keys[j])) parent.set(find(keys[j]), find(keys[i]));
// A link that stopped on the casino's own affiliate tracker (7bit.partners for 7bitcasino.com) shares the casino's
// name and part of its brand: join those too.
const brandOf = (k) => k.slice(0, k.lastIndexOf(".")).split(".").pop();
const keysByName = new Map();
for (const [k, names] of namesByRaw) for (const n of names) (keysByName.get(n) ?? keysByName.set(n, []).get(n)).push(k);
for (const keys of keysByName.values()) for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
  const a = brandOf(keys[i]), b = brandOf(keys[j]);
  if (a !== b && Math.min(a.length, b.length) >= 4 && (a.includes(b) || b.includes(a)) && !GENERIC.has(a) && !GENERIC.has(b)) parent.set(find(keys[j]), find(keys[i]));
}
const rowsByRaw = new Map();
for (const r of rows) if (r.domain) rowsByRaw.set(rawKey(r.domain), (rowsByRaw.get(rawKey(r.domain)) || 0) + 1);
const groupName = new Map(); // union root -> key: the member whose brand is the cluster base, else the most listed member
for (const [base, keys] of clusters) for (const k of keys) {
  const root = find(k), cur = groupName.get(root);
  const better = !cur || (k.slice(0, k.lastIndexOf(".")) === base && cur.slice(0, cur.lastIndexOf(".")) !== base) || (rowsByRaw.get(k) > rowsByRaw.get(cur) && cur.slice(0, cur.lastIndexOf(".")) !== base);
  if (better) groupName.set(root, k);
}
const canon = (domain) => { const k = rawKey(domain); return k ? groupName.get(find(k)) : ""; };

// Names seen for each casino, so an unresolved row can still join its casino by name.
const keyByName = new Map();
for (const r of rows) { const k = canon(r.domain); if (k) keyByName.set(normName(r.casino), k); }

const groups = new Map();
rows.forEach((r, i) => {
  r.id = `${r.source}-${String(i + 1).padStart(5, "0")}`;
  let key = canon(r.domain), keyed_by = key ? "domain" : "";
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
console.log(`keyed by domain: ${by((r) => r.keyed_by === "domain")}, by name matched to a domain: ${by((r) => r.keyed_by === "name->domain")}, by name only: ${by((r) => r.keyed_by === "name")}; hubs: ${[...HUBS].join(", ")}`);
console.log(`casinos on 3 sites: ${casinos.filter((c) => c.sources.length === 3).length}, on 2: ${casinos.filter((c) => c.sources.length === 2).length}, on 1: ${casinos.filter((c) => c.sources.length === 1).length}`);
console.log(`start via tracking link: ${casinos.filter((c) => c.start_type === "tracking").length}, via domain: ${casinos.filter((c) => c.start_type === "domain").length}, none: ${casinos.filter((c) => c.start_type === "none").length}`);
