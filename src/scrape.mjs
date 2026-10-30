// Scrapes one shard of out/jobs.json through the local Chrome or Browserless: follows the tracking link (or domain),
// records where it landed, from which country and IP, then reads the footer and the terms / payments / KYC pages and
// stores raw quotes.
// Usage, local (the installed Chrome; the VPN decides the exit; keys in .env, PROXY_PLAN=local:no):
//   node --env-file=.env src/scrape.mjs [--concurrency 6] [--ids id1,id2 [--force]]
// Usage, Browserless:
//   BROWSERLESS_TOKEN=... node src/scrape.mjs [--shard 0 --shards 1] [--concurrency 2] [--ids id1,id2 [--force]] [--deadline-minutes N]
// --force re-runs the --ids casinos that already have a result.
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from "node:fs";
import { chromium } from "playwright-core";
import { stringify } from "csv-stringify/sync";
import { extract, licenceNumbers, jurisdictions } from "./extract.mjs";
import { host, termsCandidates, otherDocs, regionalSites } from "./links.mjs";
import { exitLookup } from "./exit.mjs";
import { sessions, withBudget } from "./budget.mjs";
import { sleep, clip, TRACKER_HOSTS, lobbyStatus, settle, readLobby, bodyText, readDoc, fetchTerms, marketplaceLobby, notCasino } from "./terms.mjs";

const arg = (name, d) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : d; };
const SHARD = Number(arg("--shard", 0));
const SHARDS = Number(arg("--shards", 1));
const IDS = arg("--ids", "") ? new Set(arg("--ids").split(",").map((s) => s.trim()).filter(Boolean)) : null;
const FORCE = process.argv.includes("--force"); // with --ids: run them even when a previous result exists
const DEADLINE = Number(arg("--deadline-minutes", 0)) > 0 ? Date.now() + Number(arg("--deadline-minutes")) * 60000 : Infinity; // no new casino is started after this
const TOKEN = process.env.BROWSERLESS_TOKEN;
// An error message may carry the session URL, token included. With no token (a local plan) there is nothing to hide:
// replace(undefined, ...) would turn the word "undefined" into "***".
const redact = (m) => (TOKEN ? m.split(TOKEN).join("***") : m);
const REGION = process.env.BROWSERLESS_REGION || "production-sfo";
// Exits are tried in phases. "local:no" launches the installed Chrome on this machine (the VPN decides the country;
// the code is only a label for the rows); "datacenter:ca,de" is Browserless's datacenter proxy (2 units per MB, and
// it tunnels to domains the residential one refuses, such as bitstarz.com); "residential:..." its residential proxy
// (6 units per MB) for casinos that block hosting IPs (PlayGrand, Rokubet, BangaWin in the test set).
const PROXY_PLAN = (process.env.PROXY_PLAN || `datacenter:ca,de;residential:${process.env.EXIT_COUNTRIES || "ca,de,nz,fi,ie,br,jp,in"}`)
  .split(";").filter(Boolean).map((ph) => { const [type, list] = ph.split(":"); return { type: type.trim(), countries: list.split(",").map((c) => c.trim()).filter(Boolean) }; });
const LOCAL = PROXY_PLAN.some((p) => p.type === "local");
const LOCAL_HEADLESS = (process.env.LOCAL_HEADLESS || "true") !== "false";
const CONCURRENCY = Number(arg("--concurrency", LOCAL ? 6 : 2));
if (!TOKEN && !PROXY_PLAN.every((p) => p.type === "local")) throw new Error("BROWSERLESS_TOKEN is not set");

const OUT = `out/results/shard-${SHARD}.csv`;
mkdirSync("out/results", { recursive: true });
mkdirSync("out/text", { recursive: true });

export const COLUMNS = [
  "id", "source", "casino", "review_url", "start_type", "start_url", "status", "final_url", "final_domain", "redirect_chain",
  "exit_country", "ip", "ip_country", "countries_tried", "scraped_at", "terms_found", "pages", "licence_numbers", "jurisdictions",
  "q_licence", "q_owner", "q_withdrawal_limits", "q_withdrawal_time", "q_installments", "q_kyc", "q_restricted", "footer", "error", "terms_tried", "mb", "jev",
];

// Casinos already in this shard's CSV, or in a previous run's merged results.csv placed in out/, are not run again.
const done = new Set();
const idsIn = (file) => { for (const line of readFileSync(file, "utf8").split("\n").slice(1)) { const id = line.split(",")[0]; if (id) done.add(id.replace(/"/g, "")); } };
if (existsSync(OUT)) idsIn(OUT);
else writeFileSync(OUT, stringify([COLUMNS]));
if (existsSync("out/results.csv")) idsIn("out/results.csv");

const all = JSON.parse(readFileSync("out/jobs.json", "utf8"));
const jobs = all.filter((j, i) => i % SHARDS === SHARD && (!done.has(j.id) || (FORCE && IDS)) && (!IDS || IDS.has(j.id)));
console.log(`shard ${SHARD}/${SHARDS}: ${jobs.length} jobs to run (${done.size} already done)`);


function wsUrl(country, type = "residential") {
  // A session may need the lobby, up to three terms candidates, a click, a few guessed paths and two more
  // documents; ten minutes covers the slow single-page apps (PlayGrand, Rokubet) without leaving sessions hanging.
  const p = new URLSearchParams({ token: TOKEN, stealth: "true", timeout: "600000" });
  // "direct": no proxy, the session leaves from the Browserless region itself. Used only to resolve tracker redirects
  // that the proxy refuses (casino.guru, lcb.org give ERR_TUNNEL_CONNECTION_FAILED through it).
  if (country !== "direct") { p.set("proxy", type); p.set("proxyCountry", country); p.set("proxySticky", "true"); }
  return `wss://${REGION}.browserless.io?${p}`;
}

/**
 * Opens a browser session: the installed Chrome for the local phase, otherwise Browserless. A 429 from Browserless
 * means the plan's concurrent-session limit is full (other shards hold the sessions), so wait and try again rather
 * than fail the row.
 */
async function connect(country, type) {
  if (type === "local") return chromium.launch({ channel: "chrome", headless: LOCAL_HEADLESS, args: ["--disable-blink-features=AutomationControlled", "--lang=en-US"] });
  let delay = 4000;
  for (let i = 0; ; i++) {
    try { return await chromium.connectOverCDP(wsUrl(country, type), { timeout: 45000 }); }
    catch (e) {
      if (!/429|Too Many Requests/.test(e.message) || i >= 8) throw e;
      await sleep(delay + Math.random() * 3000);
      delay = Math.min(delay * 2, 30000);
    }
  }
}

/** Follows a tracking link without a proxy and returns the casino URL it lands on, or "" when it stays on the tracker. */
async function resolveDirect(url) {
  const browser = LOCAL ? await connect("local", "local") : await connect("direct");
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

// The local exit is one machine's VPN: asked once per process and refreshed every ten minutes (exit.mjs). A Browserless
// session has its own proxy exit, so it is asked per session.
const localExit = exitLookup();
async function whereAmI(context) {
  const p = await context.newPage();
  try {
    await p.goto("https://ipinfo.io/json", { timeout: 20000 });
    const j = JSON.parse(await p.evaluate(() => document.body.innerText));
    return { ip: j.ip || "", ip_country: j.country || "" };
  } catch { return { ip: "", ip_country: "" }; } finally { await p.close().catch(() => {}); }
}

// Residential proxy traffic is what Browserless meters most (6 units per MB; browser time is 1 unit per 30 s), and
// most of a casino page is images, video, fonts and trackers: none of it holds text, so it is never fetched. The
// blocking is done with CDP URL patterns rather than Playwright's route interception, because interception turns
// off Chromium's HTTP cache and every navigation in the terms search would then re-download the casino's JS bundle.
const BLOCK_PATTERNS = [
  "*.png*", "*.jpg*", "*.jpeg*", "*.gif*", "*.webp*", "*.avif*", "*.svg*", "*.ico*", "*.mp4*", "*.webm*", "*.m3u8*", "*.mp3*", "*.ogg*",
  "*.woff*", "*.ttf*", "*.otf*", "*/images/*", "*/img/*", "*/thumbnails/*", "*/thumbs/*", "*/videos/*",
  "*.riv*", "*.wasm*", "*.glb*", "*.gltf*", "*.hdr*", "*lottie*", "*progressive-jackpot*", "*/feeds/*", "*jackpot*feed*", "*/sw.js*",
  "*google-analytics*", "*googletagmanager*", "*doubleclick*", "*facebook.net*", "*facebook.com/tr*", "*hotjar*", "*clarity.ms*", "*intercom*",
  "*livechatinc*", "*zendesk*", "*tawk.to*", "*sentry.io*", "*segment.io*", "*segment.com*", "*mixpanel*", "*amplitude*", "*optimizely*",
  "*onesignal*", "*pusher*", "*youtube*", "*vimeo*", "*comm100*", "*cookiebot*", "*posthog*", "*smartlook*", "*fullstory*", "*freshchat*", "*crisp.chat*",
];
async function installBlocklist(page) {
  const meter = { bytes: 0 };
  try {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.setBlockedURLs", { urls: BLOCK_PATTERNS });
    cdp.on("Network.loadingFinished", (e) => { meter.bytes += e.encodedDataLength || 0; });
    // Live-bet and jackpot tickers stream over WebSockets for as long as the session lives; count their frames too.
    // Lifting the blocklist: a casino app that needs a blocked file to render its terms (see fetchTerms).
    meter.unblock = async () => { await cdp.send("Network.setBlockedURLs", { urls: [] }); return true; };
    cdp.on("Network.webSocketFrameReceived", (e) => { meter.bytes += (e.response?.payloadData || "").length; meter.ws = (meter.ws || 0) + (e.response?.payloadData || "").length; });
  } catch { /* an older Browserless build without the domain: run unblocked */ }
  return meter;
}

// Every open session, by job id, so a casino that runs past its budget has its browser closed (budget.mjs).
const live = sessions();
async function attempt(job, url, country, type) {
  const browser = await connect(country, type);
  await live.add(job.id, browser); // a casino already timed out: closed, and this throws
  try {
    const context = browser.contexts()[0] ?? (await browser.newContext({ locale: "en-US" }));
    const page = await context.newPage();
    await page.setViewportSize({ width: 1366, height: 900 });
    const meter = await installBlocklist(page);
    const chain = [];
    page.on("framenavigated", (f) => { if (f === page.mainFrame()) chain.push(f.url()); });
    let httpStatus = 0;
    try {
      const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      httpStatus = resp ? resp.status() : 0;
    } catch (e) { return { status: "load_error", error: clip(e.message, 200), chain }; }
    const text = await settle(page, httpStatus);
    const finalUrl = page.url();
    const anchors = await page.evaluate(() => [...document.querySelectorAll("a[href]")].map((a) => ({ href: a.href, text: (a.innerText || "").trim().slice(0, 80), footer: !!a.closest("footer, [class*=footer i], #footer") }))).catch(() => []);
    const status = lobbyStatus({ text, httpStatus, finalUrl, links: anchors });
    // The IP the casino saw is recorded for reached casinos only; a blocked attempt should cost seconds, not a minute.
    if (status === "parked") return { status, finalUrl, chain, ip: "", ip_country: "", httpStatus, error: "parked or for-sale domain" };
    const { ip, ip_country } = status !== "ok" ? { ip: "", ip_country: "" } : type === "local" ? await localExit() : await whereAmI(context);
    const base = { status, finalUrl, chain, ip, ip_country, httpStatus };
    if (status !== "ok") return base;

    // The lobby and its footer; a page that only asks for a country (unibet.com) is followed to the regional site.
    let lobby = await readLobby(page);
    // A lobby read before its footer rendered (jasino.com: 78 links and no legal footer once, 124 with it the next time)
    // is read once more after a reload when it gave no terms link and no clickable; the fuller read stands.
    if (!termsCandidates(lobby.links, lobby.url).length && !lobby.clickables.length) {
      try {
        await page.reload({ waitUntil: "domcontentloaded", timeout: 45000 });
        await settle(page);
        const again = await readLobby(page);
        if (termsCandidates(again.links, again.url).length || again.clickables.length || again.links.length > lobby.links.length) lobby = again;
      } catch { /* the first read stands */ }
    }
    // A lobby with almost no links did not render (Rokubet via some exits stays a blank shell): let the next country try.
    if (lobby.links.length < 5 && lobby.footer.length < 1500) return { ...base, status: "dead_or_empty", error: "lobby did not render" };
    let lobbyBody = text; // the text of the lobby the terms search will start from
    const regional = regionalSites(lobby.links, lobby.url, country);
    if (!termsCandidates(lobby.links, lobby.url).length && !lobby.clickables.length && regional.length) {
      try {
        await page.goto(regional[0], { waitUntil: "domcontentloaded", timeout: 45000 });
        await settle(page);
        lobby = await readLobby(page);
        base.finalUrl = lobby.url;
        lobbyBody = await bodyText(page);
      } catch { /* the first lobby stands */ }
    }
    // A for-sale listing on the casino's own domain links the marketplace's legal pages (betfunk.com: Dan.com).
    const market = marketplaceLobby(lobby.links, lobby.url);
    if (market) return { ...base, status: "parked", error: `domain listing: ${market}` };
    // A review or affiliate site is not a casino: it gets the parked status, with the reason.
    const nc = notCasino(`${lobbyBody}\n${lobby.footer}`, termsCandidates(lobby.links, lobby.url), lobby.url);
    if (nc) return { ...base, status: "parked", error: `not casino: ${nc}` };
    const docs = [{ label: "footer", text: lobby.footer }];
    const jev = { notes: [] };
    const terms = await fetchTerms(page, lobby, jev, { unblock: meter.unblock });
    if (terms.text) docs.push({ label: `terms ${terms.href}${terms.via !== "link" ? ` (via ${terms.via})` : ""}${terms.hidden ? " (hidden text)" : ""}${terms.pdf ? " (pdf)" : ""}`, text: terms.text.slice(0, 250000) });
    for (const p of otherDocs(lobby.links, lobby.url, terms.href ? [terms.href] : [])) {
      try {
        await page.goto(p.href, { waitUntil: "domcontentloaded", timeout: 45000 });
        const d = await readDoc(page);
        docs.push({ label: `${p.kind} ${p.href}`, text: d.text.slice(0, 250000) });
      } catch (e) { docs.push({ label: `${p.kind} ${p.href} (failed: ${clip(e.message, 80)})`, text: "" }); }
    }
    return { ...base, finalUrl: base.finalUrl, footer: lobby.footer, docs, termsTried: terms.tried, walled: !!terms.walled, mb: meter.bytes / 1048576, jev: jev.notes.join(" ") };
  } finally { live.remove(job.id, browser); await Promise.race([browser.close().catch(() => {}), sleep(10000)]); } // a session Browserless already killed may never answer
}

async function run(job) {
  const row = { id: job.id, source: job.source, casino: job.casino, review_url: job.review_url, start_type: job.start_type, start_url: job.start_url, scraped_at: new Date().toISOString() };
  if (!job.start_url) return { ...row, status: "no_url" };
  const urls = [job.start_url];
  if ((job.start_type === "tracking" || job.start_type === "resolved") && job.domain && !job.start_url.includes(host(job.domain))) urls.push(job.domain);
  const tried = [];
  let r = { status: "not_run" };
  let resolved = "";
  const hasTerms = (x) => (x.docs || []).some((d) => d.label.startsWith("terms "));
  // A lobby reached without its terms (a bot wall on the terms page via this exit, Flamez) is kept only as a
  // fallback: another exit country may be served the terms, so the rotation goes on.
  let fallback = null, noTerms = 0, mbTotal = 0;
  outer: for (const phase of PROXY_PLAN) for (let u = 0; u < urls.length; u++) {
    const url = urls[u];
    // The datacenter phase is a cheap first try: a casino that blocked it through the resolved link gets the bare
    // domain only in the residential phase.
    if (phase.type === "datacenter" && u > 0 && url !== resolved) continue;
    const tag = (c) => `${phase.type === "datacenter" ? "dc-" : phase.type === "local" ? "local-" : ""}${c}`;
    let walls = 0;
    for (const c of phase.countries) {
      if (tried.length >= 10) break outer; // ten sessions is the budget for one casino, across phases and URLs
      if (live.ended(job.id)) break outer; // timed out: its row is written, no more sessions
      tried.push(`${tag(c)}${u === 0 ? "" : "(" + (url === resolved ? "resolved" : "domain") + ")"}`);
      try { r = await attempt(job, url, c, phase.type); } catch (e) { r = { status: "connect_error", error: clip(redact(e.message), 200) }; }
      mbTotal += r.mb || 0;
      if (r.status === "ok") {
        if (hasTerms(r)) break outer;
        fallback ??= { r, exit: tried[tried.length - 1] };
        if (++noTerms >= 3) break outer; // two more exits is enough to tell a wall from a walled exit
        continue;
      }
      // A bare 403/451 is tried from every country: Rokubet refuses Canada and Germany but serves New Zealand, and
      // a blocked session costs little. Only a challenge page (bot wall, not geo) is the same from everywhere.
      if (r.status === "parked") break outer; // a for-sale page is the same from every exit; an exit that reached the casino earlier still stands as the fallback
      if (r.status === "challenge" && ++walls >= 2) break;
      const tunnel = r.status === "load_error" && /ERR_TUNNEL_CONNECTION_FAILED|ERR_NAME_NOT_RESOLVED/.test(r.error || "");
      if (tunnel || r.status === "stuck_on_tracker") {
        // The proxy refuses the tracker's domain, or the redirect never fires through it: resolve the redirect without
        // a proxy, then scrape the casino it names through the proxy countries.
        if (u === 0 && job.start_type === "tracking" && !resolved) {
          resolved = await resolveDirect(url).catch(() => "");
          if (resolved) { urls.splice(1, 0, resolved); tried.push("direct(resolve)"); }
        } else if (tunnel && phase.type !== "local" && !TRACKER_HOSTS.test(host(url))) {
          // (Locally there is no proxy to go around: a DNS failure is the casino's, and "direct" would be the same Chrome.)
          // The proxy refuses the casino's own domain (it does for some gambling sites). Last resort: no proxy, from
          // the Browserless region's egress; the row then records that country, which the casino may well block.
          tried.push("direct");
          try { r = await attempt(job, url, "direct", phase.type); } catch (e) { r = { status: "connect_error", error: clip(redact(e.message), 200) }; }
          mbTotal += r.mb || 0;
          if (r.status === "ok") { if (hasTerms(r)) break outer; fallback ??= { r, exit: "direct" }; }
        }
        break; // another country won't help for this URL
      }
    }
  }
  let exit = tried[tried.length - 1];
  if (!(r.status === "ok" && hasTerms(r)) && fallback) ({ r, exit } = fallback);
  Object.assign(row, {
    status: r.status, final_url: r.finalUrl || "", final_domain: host(r.finalUrl || ""), redirect_chain: (r.chain || []).filter((u) => u !== "about:blank").join(" > ").slice(0, 2000),
    exit_country: r.status === "ok" ? exit.replace("(domain)", "") : "", ip: r.ip || "", ip_country: r.ip_country || "", countries_tried: tried.join(" "),
    error: r.error || (r.httpStatus ? `http ${r.httpStatus}` : ""), mb: mbTotal.toFixed(1),
    jev: r.jev || "",
  });
  if (r.status === "ok") {
    const q = extract(r.docs);
    const fullText = r.docs.map((d) => d.text).join("\n");
    Object.assign(row, {
      // "no": no terms link or clickable text on the lobby, or every candidate was thin, still loading or a bot wall (see terms_tried).
      terms_found: r.docs.some((d) => d.label.startsWith("terms ") && d.text.length > 500) ? "yes" : "no", terms_tried: (r.termsTried || []).join(" | ").slice(0, 1000),
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

// Where a local run leaves from, for the log: the VPN should be on, but the run goes on either way.
if (LOCAL && jobs.length) {
  const { ip, ip_country } = await localExit();
  console.log(`local Chrome leaves from ${ip || "?"} (${ip_country || "unknown"}); the plan says ${PROXY_PLAN.find((p) => p.type === "local").countries.join("/")}`);
}

let next = 0, n = 0;
// A CDP call on a session Browserless has killed (ten-minute cap) can hang forever; with every worker stuck that way
// Node finds nothing left to run and exits with code 13 (shard 1 of the first full run). The keepalive timer holds
// the process, and a casino that exceeds its budget is written as "timeout" while its worker moves on.
const CASINO_BUDGET = 20 * 60000;
const keepalive = setInterval(() => {}, 60000);
async function worker() {
  while (next < jobs.length && Date.now() < DEADLINE) {
    const job = jobs[next++];
    const t0 = Date.now();
    const base = { id: job.id, source: job.source, casino: job.casino, review_url: job.review_url, scraped_at: new Date().toISOString() };
    // Past the budget the casino's open browser is closed (budget.mjs) and its row is a timeout.
    const row = await withBudget(job.id, run(job).catch((e) => ({ ...base, status: "crash", error: clip(e.message, 200) })), CASINO_BUDGET,
      live, () => ({ ...base, status: "timeout", error: `no result within ${CASINO_BUDGET / 60000} min` }));
    appendFileSync(OUT, stringify([COLUMNS.map((c) => row[c] ?? "")]));
    console.log(`[${++n}/${jobs.length}] ${job.id} ${job.casino} -> ${row.status} ${row.final_domain || ""} ${row.exit_country || ""} ${Math.round((Date.now() - t0) / 1000)}s ${row.mb || 0}MB`);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
clearInterval(keepalive);
if (next < jobs.length) console.log(`deadline reached: ${jobs.length - next} casinos of this shard not started; run again with previous_run_id to continue`);
process.exit(0); // hung sessions from timed-out casinos must not keep the shard alive
