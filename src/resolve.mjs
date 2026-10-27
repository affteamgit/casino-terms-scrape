// Follows every casino.guru and lcb.org tracking link with plain HTTP (no browser, no Browserless units) and records
// the casino domain it lands on. AskGamblers links refuse plain requests, but its CSV already carries each casino's
// domain, so they are skipped here.
//
// Results already committed in input/resolved.json are kept; a run only fetches links that are still unresolved
// (never tried, stuck on the tracker, or failed before leaving it). casino.guru blocks an IP after a few hundred
// requests, so the resolve workflow spreads the links over many GitHub runners (--shard i/n, each its own IP) and a
// shard stops as soon as the tracker starts refusing it.
//
// Usage: node src/resolve.mjs [--concurrency 20] [--delay-ms 0] [--limit N] [--shard i/n] [--out out/resolved.json]
//        node src/resolve.mjs --merge <dir>      combines every resolved*.json under <dir> with input/resolved.json
//                                               into out/resolved.json
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse } from "csv-parse/sync";

const arg = (name, d) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : d; };
const CONCURRENCY = Number(arg("--concurrency", 20));
const DELAY = Number(arg("--delay-ms", 0));
const LIMIT = Number(arg("--limit", 0));
const [SHARD, SHARDS] = arg("--shard", "0/1").split("/").map(Number);
const OUT = arg("--out", "out/resolved.json");
const BASE = "input/resolved.json";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const TRACKER = /(^|\.)(casino\.guru|lcb\.org|askgamblers\.com)$/i;
const BLOCK_STREAK = 15; // consecutive tracker refusals before a shard gives up on this IP

mkdirSync("out", { recursive: true });
const loadJson = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : {});
const read = (f) => parse(readFileSync(f), { columns: true, skip_empty_lines: true, bom: true });
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
/** A link is settled once it left the tracker and gave a domain; anything else is worth another try from another IP. */
const settled = (v) => v && v.domain && !v.on_tracker;
const summary = (map) => {
  const vals = Object.values(map);
  return `${vals.length} resolved, ${vals.filter(settled).length} landed on a casino domain, ${vals.filter((v) => v.on_tracker).length} stayed on the tracker, ${vals.filter((v) => v.error).length} errors`;
};

if (process.argv.includes("--merge")) {
  const dir = arg("--merge");
  const merged = loadJson(BASE);
  const files = readdirSync(dir, { recursive: true }).map(String).filter((f) => /resolved.*\.json$/.test(f));
  for (const f of files) for (const [u, v] of Object.entries(loadJson(join(dir, f)))) if (settled(v) || !settled(merged[u])) merged[u] = v;
  writeFileSync("out/resolved.json", JSON.stringify(merged));
  console.log(`merged ${files.length} files -> out/resolved.json: ${summary(merged)}`);
  process.exit(0);
}

const resolved = { ...loadJson(BASE), ...loadJson(OUT) };
let links = [
  ...read("input/casinoguru_reviews_final.csv").map((r) => r.tracking_link),
  ...read("input/lcb_reviews_final.csv").map((r) => r.affiliate_url),
].filter((u) => /^https?:\/\//.test(u) && !settled(resolved[u]));
links = [...new Set(links)].filter((_, i) => i % SHARDS === SHARD);
if (LIMIT) links = links.slice(0, LIMIT);
console.log(`${links.length} links to resolve in shard ${SHARD}/${SHARDS} (${Object.values(resolved).filter(settled).length} already settled)`);

/** Follows redirects by hand so the whole chain is kept; a page that redirects by meta refresh or JS is followed once.
 *  A destination that refuses the connection still yields its domain, which is all the grouping needs. */
async function follow(url) {
  const chain = [url];
  let current = url;
  for (let hop = 0; hop < 10; hop++) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 20000);
    let resp;
    try {
      resp = await fetch(current, { redirect: "manual", signal: ctl.signal, headers: { "user-agent": UA, accept: "text/html,*/*;q=0.8", "accept-language": "en-US,en;q=0.9" } });
    } catch (e) {
      if (hop > 0 && !TRACKER.test(host(current))) return { final: current, status: 0, chain, error: `destination unreachable: ${String(e.cause?.code || e.message).slice(0, 60)}` };
      throw e;
    } finally { clearTimeout(t); }
    const loc = resp.headers.get("location");
    if (resp.status >= 300 && resp.status < 400 && loc) {
      current = new URL(loc, current).href;
      chain.push(current);
      continue;
    }
    if (TRACKER.test(host(current)) && (resp.headers.get("content-type") || "").includes("html")) {
      // Still on the tracker with a 200: look for a meta refresh or a JS location redirect in the page.
      const html = (await resp.text()).slice(0, 200000);
      const m = html.match(/http-equiv=["']?refresh["']?[^>]*url=['"]?([^'">\s]+)/i) || html.match(/(?:location\.(?:href|replace|assign)\s*[=(]\s*|window\.location\s*=\s*)["']([^"']+)["']/i);
      if (m) { current = new URL(m[1].replace(/&amp;/g, "&"), current).href; chain.push(current); continue; }
    }
    return { final: current, status: resp.status, chain };
  }
  return { final: current, status: 0, chain, error: "too many redirects" };
}

// A bad redirect target or a dropped socket must cost one link, not the run: log it and carry on.
process.on("uncaughtException", (e) => console.error("uncaught:", e && e.message));
process.on("unhandledRejection", (e) => console.error("unhandled:", e && e.message));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let i = 0, done = 0, streak = 0, stopped = false;
async function worker() {
  while (i < links.length && !stopped) {
    const url = links[i++];
    try {
      const r = await follow(url);
      const onTracker = TRACKER.test(host(r.final));
      resolved[url] = { final: r.final, domain: host(r.final), on_tracker: onTracker, status: r.status, hops: r.chain.length - 1, error: r.error || "" };
      // The tracker answering 403/429 itself (no redirect) means this IP is being refused.
      streak = onTracker && r.hops === 0 && [403, 429].includes(r.status) ? streak + 1 : 0;
      if (streak >= BLOCK_STREAK && !stopped) { stopped = true; console.log(`tracker refused ${streak} links in a row; stopping this shard with ${links.length - i} links left for another IP`); }
    } catch (e) {
      resolved[url] = { final: "", domain: "", on_tracker: false, status: 0, hops: 0, error: String(e.cause?.code || e.message || e).slice(0, 120) };
    }
    if (++done % 100 === 0) { writeFileSync(OUT, JSON.stringify(resolved)); console.log(`${done}/${links.length}`); }
    if (DELAY) await sleep(DELAY);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
writeFileSync(OUT, JSON.stringify(resolved));
console.log(`done: ${summary(resolved)}`);
