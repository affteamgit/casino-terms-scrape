// Scrapes one shard of out/jobs.json through Browserless: follows the tracking link (or domain), records where it
// landed, from which country and IP, then reads the footer and the terms / payments / KYC pages and stores raw quotes.
// Usage: BROWSERLESS_TOKEN=... node src/scrape.mjs [--shard 0 --shards 1] [--concurrency 2] [--ids id1,id2]
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from "node:fs";
import { chromium } from "playwright-core";
import { stringify } from "csv-stringify/sync";
import { extract, licenceNumbers, jurisdictions } from "./extract.mjs";

const arg = (name, d) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : d; };
const SHARD = Number(arg("--shard", 0));
const SHARDS = Number(arg("--shards", 1));
const CONCURRENCY = Number(arg("--concurrency", 2));
const IDS = arg("--ids", "") ? new Set(arg("--ids").split(",")) : null;
const TOKEN = process.env.BROWSERLESS_TOKEN;
const REGION = process.env.BROWSERLESS_REGION || "production-sfo";
const COUNTRIES = (process.env.EXIT_COUNTRIES || "ca,de,nz,fi,ie,br,jp,in").split(",");
if (!TOKEN) throw new Error("BROWSERLESS_TOKEN is not set");

const OUT = `out/results/shard-${SHARD}.csv`;
mkdirSync("out/results", { recursive: true });
mkdirSync("out/text", { recursive: true });

export const COLUMNS = [
  "id", "source", "casino", "review_url", "start_type", "start_url", "status", "final_url", "final_domain", "redirect_chain",
  "exit_country", "ip", "ip_country", "countries_tried", "scraped_at", "terms_found", "pages", "licence_numbers", "jurisdictions",
  "q_licence", "q_owner", "q_withdrawal_limits", "q_withdrawal_time", "q_installments", "q_kyc", "q_restricted", "footer", "error",
];

const done = new Set();
if (existsSync(OUT)) for (const line of readFileSync(OUT, "utf8").split("\n").slice(1)) { const id = line.split(",")[0]; if (id) done.add(id.replace(/"/g, "")); }
else writeFileSync(OUT, stringify([COLUMNS]));

const all = JSON.parse(readFileSync("out/jobs.json", "utf8"));
const jobs = all.filter((j, i) => i % SHARDS === SHARD && !done.has(j.id) && (!IDS || IDS.has(j.id)));
console.log(`shard ${SHARD}/${SHARDS}: ${jobs.length} jobs to run (${done.size} already done)`);

const TRACKER_HOSTS = /(^|\.)(casino\.guru|askgamblers\.com|lcb\.org)$/i;
const BLOCK_TEXT = /not (available|accessible) (in|from) your (country|region|location)|access (is )?(denied|restricted)|restricted (country|region|territor)|can(?:'|no)t access from this country|unavailable in your (country|region)|we do not accept players from|your country is (blocked|restricted)|403 forbidden|error 1020|sorry, you have been blocked/i;
const CHALLENGE_TEXT = /just a moment|checking your browser|verify you are human|cf-chl|attention required/i;
const LINK_KINDS = [
  ["terms", /terms|t\s*&\s*c|conditions|general[-\s]?terms|\btos\b|user[-\s]agreement/i],
  ["payments", /payment|banking|withdraw|cashier|deposit[-\s]?(methods|options)/i],
  ["kyc", /\bkyc\b|\baml\b|know[-\s]your|verification|anti[-\s]money/i],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
const clip = (s, n) => (s || "").replace(/\s+/g, " ").trim().slice(0, n);

function wsUrl(country) {
  const p = new URLSearchParams({ token: TOKEN, stealth: "true", timeout: "240000" });
  // "direct": no proxy, the session leaves from the Browserless region itself. Used only to resolve tracker redirects
  // that the residential proxy refuses (casino.guru, lcb.org give ERR_TUNNEL_CONNECTION_FAILED through it).
  if (country !== "direct") { p.set("proxy", "residential"); p.set("proxyCountry", country); p.set("proxySticky", "true"); }
  return `wss://${REGION}.browserless.io?${p}`;
}

/**
 * Opens a Browserless session. A 429 means the plan's concurrent-session limit is full (other shards hold the
 * sessions), so wait and try again rather than fail the row.
 */
async function connect(country) {
  let delay = 15000;
  for (let i = 0; ; i++) {
    try { return await chromium.connectOverCDP(wsUrl(country), { timeout: 45000 }); }
    catch (e) {
      if (!/429|Too Many Requests/.test(e.message) || i >= 5) throw e;
      await sleep(delay + Math.random() * 5000);
      delay = Math.min(delay * 2, 120000);
    }
  }
}

/** Follows a tracking link without a proxy and returns the casino URL it lands on, or "" when it stays on the tracker. */
async function resolveDirect(url) {
  const browser = await connect("direct");
  try {
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = await context.newPage();
    await installBlocklist(page);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
    for (let i = 0; i < 4 && TRACKER_HOSTS.test(host(page.url())); i++) await sleep(2500);
    const finalUrl = page.url();
    return TRACKER_HOSTS.test(host(finalUrl)) || !/^https?:/.test(finalUrl) ? "" : finalUrl;
  } finally { await browser.close().catch(() => {}); }
}

async function bodyText(page) {
  return page.evaluate(() => document.body ? document.body.innerText : "").catch(() => "");
}

async function settle(page) {
  await page.waitForLoadState("domcontentloaded", { timeout: 30000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {});
  for (let i = 0; i < 3; i++) {
    const t = await bodyText(page);
    if (!CHALLENGE_TEXT.test(t.slice(0, 2000)) && t.length > 200) return t;
    await sleep(6000);
  }
  return bodyText(page);
}

async function whereAmI(context) {
  const p = await context.newPage();
  try {
    await p.goto("https://ipinfo.io/json", { timeout: 20000 });
    const j = JSON.parse(await p.evaluate(() => document.body.innerText));
    return { ip: j.ip || "", ip_country: j.country || "" };
  } catch { return { ip: "", ip_country: "" }; } finally { await p.close().catch(() => {}); }
}

// Residential proxy traffic is what Browserless meters most (about 56 proxy units per row in the pilot), and most
// of a casino page is images, video and trackers. None of it holds text, so it is never fetched.
const BLOCKED_TYPES = new Set(["image", "media", "font", "imageset", "texttrack", "manifest"]);
const BLOCKED_HOSTS = /google-analytics|googletagmanager|doubleclick|facebook\.net|facebook\.com\/tr|hotjar|clarity\.ms|intercom|livechatinc|zendesk|tawk\.to|sentry\.io|segment\.(io|com)|mixpanel|amplitude|optimizely|onesignal|pusher|youtube|vimeo|\.mp4(\?|$)|\.webm(\?|$)|\.gif(\?|$)/i;
async function installBlocklist(page) {
  await page.route("**/*", (route) => {
    const req = route.request();
    if (BLOCKED_TYPES.has(req.resourceType()) || BLOCKED_HOSTS.test(req.url())) return route.abort();
    return route.continue();
  }).catch(() => {});
}

async function attempt(job, url, country) {
  const browser = await connect(country);
  try {
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = await context.newPage();
    await page.setViewportSize({ width: 1366, height: 900 });
    await installBlocklist(page);
    const chain = [];
    page.on("framenavigated", (f) => { if (f === page.mainFrame()) chain.push(f.url()); });
    let status = "ok", httpStatus = 0;
    try {
      const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      httpStatus = resp ? resp.status() : 0;
    } catch (e) { return { status: "load_error", error: clip(e.message, 200), chain }; }
    const text = await settle(page);
    const finalUrl = page.url();
    const { ip, ip_country } = await whereAmI(context);
    if (CHALLENGE_TEXT.test(text.slice(0, 2000)) && text.length < 3000) status = "challenge";
    else if (BLOCK_TEXT.test(text.slice(0, 5000))) status = "geo_blocked"; // the page says so
    else if (httpStatus === 403 || httpStatus === 451) status = "blocked_http"; // a bare 403/451: geo-block or bot wall, the page does not say
    else if (TRACKER_HOSTS.test(host(finalUrl))) status = "stuck_on_tracker";
    else if (httpStatus >= 400 || text.length < 200) status = "dead_or_empty";
    const base = { status, finalUrl, chain, ip, ip_country, httpStatus };
    if (status !== "ok") return base;

    // Single-page lobbies render their footer late and load more as you scroll: scroll down and wait for the footer's
    // links (or any terms link) before reading, up to ~15 s.
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
      await sleep(3000);
      const ready = await page.evaluate(() => {
        const links = [...document.querySelectorAll("a[href]")];
        return links.some((a) => /terms|conditions|t&c/i.test(a.innerText + a.href)) || document.querySelectorAll("footer a[href], [class*=footer i] a[href]").length > 5;
      }).catch(() => false);
      if (ready) break;
    }
    await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
    const footer = await page.evaluate(() => {
      const f = document.querySelector("footer, [class*=footer i], #footer");
      const t = f ? f.innerText : "";
      return t && t.length > 80 ? t : document.body.innerText.slice(-5000);
    }).catch(() => "");
    const links = await page.evaluate(() => [...document.querySelectorAll("a[href]")].map((a) => ({ href: a.href, text: (a.innerText || a.getAttribute("aria-label") || "").trim().slice(0, 80) }))).catch(() => []);
    // Only the casino's own pages (same registrable domain, so docs.bspin.io counts for bspin.io): a regulator's
    // verification page or a payment provider's site is not the casino's terms.
    const site = host(finalUrl).split(".").slice(-2).join(".");
    const own = (l) => host(l.href).endsWith(site);
    const picked = [];
    for (const [kind, re] of LINK_KINDS) {
      const hit = links.find((l) => /^https?:/.test(l.href) && own(l) && (re.test(l.text) || re.test(l.href)) && !/privacy|cookie|responsible|bonus|sport.?rules|affiliate/i.test(l.text + l.href) && !picked.some((p) => p.href === l.href));
      if (hit) picked.push({ kind, href: hit.href });
    }
    const docs = [{ label: "footer", text: footer }];
    for (const p of picked) {
      try {
        await page.goto(p.href, { waitUntil: "domcontentloaded", timeout: 45000 });
        const t = await settle(page);
        docs.push({ label: `${p.kind} ${p.href}`, text: t.slice(0, 250000) });
      } catch (e) { docs.push({ label: `${p.kind} ${p.href} (failed: ${clip(e.message, 80)})`, text: "" }); }
    }
    return { ...base, footer, docs };
  } finally { await browser.close().catch(() => {}); }
}

async function run(job) {
  const row = { id: job.id, source: job.source, casino: job.casino, review_url: job.review_url, start_type: job.start_type, start_url: job.start_url, scraped_at: new Date().toISOString() };
  if (!job.start_url) return { ...row, status: "no_url" };
  const urls = [job.start_url];
  if (job.start_type === "tracking" && job.domain) urls.push(job.domain);
  const tried = [];
  let r = { status: "not_run" };
  let resolved = "";
  outer: for (let u = 0; u < urls.length; u++) {
    const url = urls[u];
    let walls = 0;
    for (const c of COUNTRIES) {
      tried.push(`${c}${u === 0 ? "" : "(" + (url === resolved ? "resolved" : "domain") + ")"}`);
      try { r = await attempt(job, url, c); } catch (e) { r = { status: "connect_error", error: clip(e.message.replace(TOKEN, "***"), 200) }; }
      if (r.status === "ok") break outer;
      // A bare 403/451 from two countries in a row is a licensed-market brand refusing everyone outside its
      // markets (Videoslots, BetVictor, Sky Casino in the pilot); the remaining countries would only cost sessions.
      if (r.status === "blocked_http" && ++walls >= 2) break;
      const tunnel = r.status === "load_error" && /ERR_TUNNEL_CONNECTION_FAILED|ERR_NAME_NOT_RESOLVED/.test(r.error || "");
      if (tunnel || r.status === "stuck_on_tracker") {
        // The proxy refuses the tracker's domain, or the redirect never fires through it: resolve the redirect without
        // a proxy, then scrape the casino it names through the proxy countries.
        if (u === 0 && job.start_type === "tracking" && !resolved) {
          resolved = await resolveDirect(url).catch(() => "");
          if (resolved) { urls.splice(1, 0, resolved); tried.push("direct(resolve)"); }
        } else if (tunnel && !TRACKER_HOSTS.test(host(url))) {
          // The proxy refuses the casino's own domain (it does for some gambling sites). Last resort: no proxy, from
          // the Browserless region's egress; the row then records that country, which the casino may well block.
          tried.push("direct");
          try { r = await attempt(job, url, "direct"); } catch (e) { r = { status: "connect_error", error: clip(e.message.replace(TOKEN, "***"), 200) }; }
          if (r.status === "ok") break outer;
        }
        break; // another country won't help for this URL
      }
    }
  }
  Object.assign(row, {
    status: r.status, final_url: r.finalUrl || "", final_domain: host(r.finalUrl || ""), redirect_chain: (r.chain || []).filter((u) => u !== "about:blank").join(" > ").slice(0, 2000),
    exit_country: r.status === "ok" ? tried[tried.length - 1].replace("(domain)", "") : "", ip: r.ip || "", ip_country: r.ip_country || "", countries_tried: tried.join(" "),
    error: r.error || (r.httpStatus ? `http ${r.httpStatus}` : ""),
  });
  if (r.status === "ok") {
    const q = extract(r.docs);
    const fullText = r.docs.map((d) => d.text).join("\n");
    Object.assign(row, {
      // "no" usually means a reduced landing page (direct exit from a country the casino restricts) or a lobby without footer links.
      terms_found: r.docs.some((d) => d.label.startsWith("terms ") && d.text.length > 500) ? "yes" : "no",
      pages: r.docs.map((d) => d.label).join(" | "),
      licence_numbers: licenceNumbers(fullText).join(", "),
      jurisdictions: jurisdictions(q.licence, r.footer).join(", "),
      q_licence: q.licence.join("\n"), q_owner: q.owner.join("\n"), q_withdrawal_limits: q.withdrawal_limits.join("\n"),
      q_withdrawal_time: q.withdrawal_time.join("\n"), q_installments: q.installments.join("\n"), q_kyc: q.kyc.join("\n"),
      q_restricted: q.restricted.join("\n"), footer: clip(r.footer, 3000),
    });
    writeFileSync(`out/text/${job.id}.txt`, r.docs.map((d) => `===== ${d.label}\n${d.text}`).join("\n\n"));
  }
  return row;
}

let next = 0, n = 0;
async function worker() {
  while (next < jobs.length) {
    const job = jobs[next++];
    const t0 = Date.now();
    const row = await run(job).catch((e) => ({ id: job.id, source: job.source, casino: job.casino, review_url: job.review_url, status: "crash", error: clip(e.message, 200), scraped_at: new Date().toISOString() }));
    appendFileSync(OUT, stringify([COLUMNS.map((c) => row[c] ?? "")]));
    console.log(`[${++n}/${jobs.length}] ${job.id} ${job.casino} -> ${row.status} ${row.final_domain || ""} ${row.exit_country || ""} ${Math.round((Date.now() - t0) / 1000)}s`);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
