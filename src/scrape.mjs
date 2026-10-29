// Scrapes one shard of out/jobs.json through Browserless: follows the tracking link (or domain), records where it
// landed, from which country and IP, then reads the footer and the terms / payments / KYC pages and stores raw quotes.
// Usage: BROWSERLESS_TOKEN=... node src/scrape.mjs [--shard 0 --shards 1] [--concurrency 2] [--ids id1,id2]
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from "node:fs";
import { chromium } from "playwright-core";
import { stringify } from "csv-stringify/sync";
import { extract, licenceNumbers, jurisdictions } from "./extract.mjs";
import { termsCandidates, otherDocs, regionalSites, registrable } from "./links.mjs";

const arg = (name, d) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : d; };
const SHARD = Number(arg("--shard", 0));
const SHARDS = Number(arg("--shards", 1));
const CONCURRENCY = Number(arg("--concurrency", 2));
const IDS = arg("--ids", "") ? new Set(arg("--ids").split(",")) : null;
const DEADLINE = Number(arg("--deadline-minutes", 0)) > 0 ? Date.now() + Number(arg("--deadline-minutes")) * 60000 : Infinity; // no new casino is started after this
const TOKEN = process.env.BROWSERLESS_TOKEN;
const REGION = process.env.BROWSERLESS_REGION || "production-sfo";
// Exits are tried in phases: the datacenter proxy first (2 units per MB, and it tunnels to domains the residential
// one refuses, such as bitstarz.com), then the residential proxy (6 units per MB) for casinos that block hosting IPs
// (PlayGrand, Rokubet, BangaWin in the test set). Each phase lists its exit countries.
const PROXY_PLAN = (process.env.PROXY_PLAN || `datacenter:ca,de;residential:${process.env.EXIT_COUNTRIES || "ca,de,nz,fi,ie,br,jp,in"}`)
  .split(";").filter(Boolean).map((ph) => { const [type, list] = ph.split(":"); return { type: type.trim(), countries: list.split(",").map((c) => c.trim()).filter(Boolean) }; });
if (!TOKEN) throw new Error("BROWSERLESS_TOKEN is not set");

const OUT = `out/results/shard-${SHARD}.csv`;
mkdirSync("out/results", { recursive: true });
mkdirSync("out/text", { recursive: true });

export const COLUMNS = [
  "id", "source", "casino", "review_url", "start_type", "start_url", "status", "final_url", "final_domain", "redirect_chain",
  "exit_country", "ip", "ip_country", "countries_tried", "scraped_at", "terms_found", "pages", "licence_numbers", "jurisdictions",
  "q_licence", "q_owner", "q_withdrawal_limits", "q_withdrawal_time", "q_installments", "q_kyc", "q_restricted", "footer", "error", "terms_tried", "mb",
];

// Casinos already in this shard's CSV, or in a previous run's merged results.csv placed in out/, are not run again.
const done = new Set();
const idsIn = (file) => { for (const line of readFileSync(file, "utf8").split("\n").slice(1)) { const id = line.split(",")[0]; if (id) done.add(id.replace(/"/g, "")); } };
if (existsSync(OUT)) idsIn(OUT);
else writeFileSync(OUT, stringify([COLUMNS]));
if (existsSync("out/results.csv")) idsIn("out/results.csv");

const all = JSON.parse(readFileSync("out/jobs.json", "utf8"));
const jobs = all.filter((j, i) => i % SHARDS === SHARD && !done.has(j.id) && (!IDS || IDS.has(j.id)));
console.log(`shard ${SHARD}/${SHARDS}: ${jobs.length} jobs to run (${done.size} already done)`);

const TRACKER_HOSTS = /(^|\.)(casino\.guru|askgamblers\.com|lcb\.org)$/i;
const BLOCK_TEXT = /not (available|accessible) (in|from) your (country|region|location)|access (is )?(denied|restricted)|restricted (country|region|territor)|can(?:'|no)t access from this country|unavailable in your (country|region)|we do not accept players from|your country is (blocked|restricted)|403 forbidden|error 1020|sorry, you have been blocked/i;
const CHALLENGE_TEXT = /just a moment|checking your browser|verify you are human|cf-chl|attention required/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
const clip = (s, n) => (s || "").replace(/\s+/g, " ").trim().slice(0, n);

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
 * Opens a Browserless session. A 429 means the plan's concurrent-session limit is full (other shards hold the
 * sessions), so wait and try again rather than fail the row.
 */
async function connect(country, type) {
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

// A bare 403/451 is the casino's answer, not a page still loading: it is read once, without the idle and challenge waits.
async function settle(page, httpStatus = 0) {
  await page.waitForLoadState("domcontentloaded", { timeout: 30000 }).catch(() => {});
  if (httpStatus === 403 || httpStatus === 451) { const t = await bodyText(page); if (!CHALLENGE_TEXT.test(t.slice(0, 2000))) return t; }
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
    cdp.on("Network.webSocketFrameReceived", (e) => { meter.bytes += (e.response?.payloadData || "").length; meter.ws = (meter.ws || 0) + (e.response?.payloadData || "").length; });
  } catch { /* an older Browserless build without the domain: run unblocked */ }
  return meter;
}

// Single-page lobbies render their footer late and load more games as you scroll: scroll to the bottom until a
// terms link is present or the set of links stops changing, up to ~30 s. Then collect the footer text, every
// anchor (with whether it sits in the footer) and, for apps that route from plain elements with a click handler
// instead of anchors (Lebull's footer), the short texts that read like a terms link, marked so they can be clicked.
const CLICK_TEXT = "terms|conditions|t\\s*&\\s*c|\\btos\\b|user[-\\s]agreement|termos|condi[cç][õo]es|condiciones|bedingungen|\\bagb\\b|r[eè]gles|regulamin";
async function readLobby(page) {
  let last = -1, stable = 0;
  for (let i = 0; i < 10; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
    await sleep(3000);
    const n = await page.evaluate(() => {
      const links = [...document.querySelectorAll("a[href]")];
      return { a: links.length, t: links.some((a) => /terms|conditions|t&c/i.test(a.innerText + a.getAttribute("href"))) };
    }).catch(() => ({ a: 0, t: false }));
    if (n.t) break;
    stable = n.a === last && n.a > 10 ? stable + 1 : 0;
    if (stable >= 2 && i >= 3) break;
    last = n.a;
  }
  // Read with the footer in view: some apps mount footer sections only while they are on screen (Lebull's legal
  // links vanished from the DOM once the page was scrolled back to the top).
  const lobby = await page.evaluate((clickRe) => {
    const re = new RegExp(clickRe, "i");
    const inFooter = (el) => !!el.closest("footer, [class*=footer i], #footer");
    const f = document.querySelector("footer, [class*=footer i], #footer");
    const footer = f && f.innerText.length > 80 ? f.innerText : document.body.innerText.slice(-5000);
    const links = [...document.querySelectorAll("a[href]")].map((a) => ({ href: a.href, text: (a.innerText || a.getAttribute("aria-label") || "").trim().slice(0, 80), footer: inFooter(a) }));
    const clickables = [];
    for (const el of document.querySelectorAll("footer *, [class*=footer i] *, nav *, [class*=menu i] *, li, span, div, p, button")) {
      const text = (el.innerText || "").trim();
      if (el.children.length || text.length > 40 || !re.test(text) || /privacy|cookie|bonus|promo|sport|rules/i.test(text) || el.closest("a[href]")) continue;
      if (clickables.some((c) => c.text === text)) continue;
      el.setAttribute("data-cts", String(clickables.length));
      clickables.push({ text, footer: inFooter(el), sel: `[data-cts="${clickables.length}"]` });
      if (clickables.length >= 6) break;
    }
    clickables.sort((a, b) => (b.footer ? 1 : 0) - (a.footer ? 1 : 0));
    return { url: location.href, footer, links, clickables };
  }, CLICK_TEXT).catch(() => ({ url: page.url(), footer: "", links: [], clickables: [] }));
  return lobby;
}

// A terms page is only read once its text has stopped growing: single-page apps show the shell first
// ("Loading Terms and Conditions…" on BangaWin) and fill the document in later. A WAF or bot-check page is a
// failure, not a document.
const DOC_WALL = /WAF Block|Performing security verification|Just a moment|Attention Required|Access Denied|Checking your browser|verify you are human/i;
const DOC_LOADING = /\bloading\b/i;
// A page whose first few hundred words are mostly the same token is a font-measurement or skeleton placeholder
// ("word word word …" on Winoly), not content.
const placeholder = (t) => new Set(t.slice(0, 3000).toLowerCase().split(/\s+/)).size < 40;
// The general terms talk about terms throughout; a help-centre home page or a promotion card does not.
const TERMS_WORDS = /\bterms?\b|\bconditions?\b|agreement|termos|condi[cç]|\bagb\b|bedingungen|r[eè]gles|regulamin|условия|правила|şartlar|villkor|vilkår|ehdot|voorwaarden/gi;
const readsLikeTerms = (t) => t.length >= 2000 && (t.match(TERMS_WORDS) || []).length >= 5;
// `want` says what a finished document looks like; until the text satisfies it the wait goes on, since a shell
// with only the navigation is stable long before the document itself arrives (NetBet's help pages).
async function readDoc(page, budget = 25000, want = (t) => t.length >= 500) {
  const t0 = Date.now();
  let lastLen = -1, wallSince = 0;
  while (Date.now() - t0 < budget) {
    const t = await bodyText(page);
    const head = t.slice(0, 1500);
    // A bot wall that has not cleared in 12 s will not: give up early, the caller moves on.
    if (DOC_WALL.test(head)) { wallSince ||= Date.now(); if (Date.now() - wallSince > 12000) return { ok: false, text: t, note: "wall" }; } else wallSince = 0;
    if (t.length >= 500 && !DOC_WALL.test(head) && !DOC_LOADING.test(t.slice(0, 400)) && !placeholder(t) && want(t)) {
      if (t.length === lastLen) return { ok: true, text: t };
      lastLen = t.length;
    }
    await sleep(1500);
  }
  const t = await bodyText(page);
  const wall = DOC_WALL.test(t.slice(0, 1500));
  return { ok: t.length >= 500 && !wall && !placeholder(t), text: t, note: wall ? "wall" : t.length < 500 ? "thin" : placeholder(t) ? "placeholder" : "still loading" };
}

/** Clicks what looks like a collapsed section header; returns how many were opened. */
async function expandSections(page) {
  return page.evaluate(() => {
    const els = [...document.querySelectorAll('[aria-expanded="false"], details:not([open]) > summary, [class*="accordion" i] [class*="header" i], [class*="accordion" i] [class*="title" i], [class*="collaps" i] [class*="header" i], [class*="collaps" i] [class*="title" i]')]
      .filter((el) => el.offsetParent !== null && (el.innerText || "").trim().length < 120 && !el.closest("nav, header, footer, [class*=menu i], [class*=cookie i]"));
    for (const el of els.slice(0, 60)) { try { el.click(); } catch { /* not clickable */ } }
    return els.length;
  }).catch(() => 0);
}

/**
 * Opens the casino's terms, in this order: anchors that score as the general terms (up to three); for apps whose
 * footer routes from plain elements, a click on the element that reads like the terms link; the sitemap and the
 * paths casinos commonly use; and last, anchors that scored as a promotion's terms, which are better than nothing.
 * Returns the page's text and URL, and what was tried.
 */
const dbg = (...a) => { if (process.env.DEBUG) console.error("[debug]", ...a); };
async function fetchTerms(page, lobby) {
  const tried = [];
  const cands = termsCandidates(lobby.links, lobby.url);
  dbg(lobby.url, `${lobby.links.length} links, candidates:`, cands.slice(0, 6).map((c) => `${c.score} ${c.href} "${c.text.slice(0, 30)}"`).join(" | "), "clickables:", lobby.clickables.map((c) => `"${c.text}"${c.footer ? "(footer)" : ""}`).join(" | "));
  const tryLink = async (c, lenient = false) => {
    try { await page.goto(c.href, { waitUntil: "domcontentloaded", timeout: 45000 }); } catch (e) { tried.push(`${c.href} (${clip(e.message, 60)})`); return null; }
    let d = await readDoc(page, 35000, lenient ? undefined : readsLikeTerms); // BangaWin bounces through an auth callback for ~20 s before the text arrives
    // A terms page laid out as an accordion shows only its section titles (SoftSwiss "/rules" pages): open every
    // collapsed section and read again.
    if (!d.ok || !readsLikeTerms(d.text)) { if (await expandSections(page)) d = await readDoc(page, 10000, lenient ? undefined : readsLikeTerms); }
    const good = d.ok && (lenient || readsLikeTerms(d.text));
    dbg("link", c.href, good ? `ok ${d.text.length} chars` : d.ok ? "not terms-like" : d.note);
    if (good) return { href: page.url(), text: d.text, via: "link", tried };
    tried.push(`${c.href} (${d.ok ? "not terms-like" : d.note})`);
    return null;
  };
  // An affiliate landing carries its tracking parameters into every link (go.netbet.co.uk); the page behind the
  // clean URL is the one a player reads, so it is tried first.
  const clean = (c) => ({ ...c, href: c.href.replace(/\?.*$/, "") });
  for (const c of cands.filter((c) => c.score > 0).slice(0, 3)) {
    for (const v of c.href.includes("?") ? [clean(c), c] : [c]) { const r = await tryLink(v); if (r) return r; }
    // The site walls its deeper pages from this exit (Flamez): nothing else on it will open either.
    if (/\(wall\)$/.test(tried[tried.length - 1] || "")) return { href: "", text: "", via: "", tried, walled: true };
  }
  for (const c of lobby.clickables.slice(0, 2)) {
    try {
      if (page.url() !== lobby.url) { await page.goto(lobby.url, { waitUntil: "domcontentloaded", timeout: 45000 }); await settle(page); lobby = await readLobby(page); }
      const target = lobby.clickables.find((x) => x.text === c.text);
      if (!target) { tried.push(`click "${c.text}" (gone)`); continue; }
      const before = await bodyText(page);
      // A script click: the element may sit under an overlay or outside the viewport, which a real click refuses.
      await page.evaluate((sel) => { const el = document.querySelector(sel); el.scrollIntoView({ block: "center" }); el.click(); }, target.sel);
      // Either the app navigates, or it opens the document in place.
      for (let i = 0; i < 8 && page.url() === lobby.url && (await bodyText(page)).length < before.length + 2000; i++) await sleep(1500);
      const d = await readDoc(page, 15000, readsLikeTerms);
      const navigated = page.url() !== lobby.url, grew = d.text.length >= before.length + 2000;
      dbg("click", c.text, navigated ? page.url() : "no navigation", d.text.length, "chars");
      if ((navigated ? d.ok : grew) && readsLikeTerms(d.text)) return { href: navigated ? page.url() : `${lobby.url}#"${c.text}"`, text: d.text, via: "click", tried };
      tried.push(`click "${c.text}" (${navigated ? (d.ok ? "not terms-like" : d.note) : "nothing opened"})`);
    } catch (e) { tried.push(`click "${c.text}" (${clip(e.message, 60)})`); }
  }
  // The registration page always links the terms a player must accept (PlayGrand's lobby links only promotions'
  // terms): scan it, read-only, when the lobby gave nothing.
  const signup = lobby.links.find((l) => /^https?:/.test(l.href) && host(l.href).endsWith(registrable(host(lobby.url))) && /sign.?up|register|join|create.?account|registration/i.test(l.text + " " + new URL(l.href).pathname) && !/login|sign.?in|affiliate/i.test(l.text + " " + new URL(l.href).pathname));
  if (signup) {
    try {
      await page.goto(signup.href, { waitUntil: "domcontentloaded", timeout: 30000 });
      await settle(page);
      const sub = await readLobby(page);
      const subCands = termsCandidates(sub.links, lobby.url).filter((c) => c.score > 0).slice(0, 2);
      dbg("signup page", signup.href, "candidates:", subCands.map((c) => `${c.score} ${c.href}`).join(" | "));
      for (const c of subCands) { const r = await tryLink(c); if (r) return { ...r, via: "signup-page" }; }
      if (!subCands.length) tried.push(`signup page ${signup.href} (no terms link)`);
    } catch (e) { tried.push(`signup page ${signup.href} (${clip(e.message, 60)})`); }
  }
  // Casinos always have terms, so keep looking: the site's sitemap, then the paths casinos commonly use, opened in
  // the browser so a single-page app routes them. A hit must read like terms, not the lobby shell.
  const origin = new URL(lobby.url).origin;
  const lang = (new URL(lobby.url).pathname.match(/^\/[a-z]{2}(?:-[a-z]{2})?(?=\/|$)/i) || [""])[0];
  const guesses = [];
  try {
    await page.goto(`${origin}/sitemap.xml`, { waitUntil: "domcontentloaded", timeout: 20000 });
    const xml = await page.evaluate(() => document.documentElement.outerHTML).catch(() => "");
    for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
      if (/terms|conditions|\btos\b|termos|\bagb\b|regulamin/i.test(m[1]) && !/privacy|cookie|bonus|promo|affiliate|sport|racing|poker|game/i.test(m[1])) guesses.push(m[1]);
      if (guesses.length >= 3) break;
    }
  } catch { /* no sitemap */ }
  for (const p of ["/terms-and-conditions", "/terms", "/terms-of-service", "/info/terms-and-conditions", "/user-agreement", "/rules"]) {
    guesses.push(`${origin}${lang}${p}`);
    if (lang) guesses.push(`${origin}${p}`);
  }
  const lobbyText = (await bodyText(page).catch(() => "")) || "";
  const guessUntil = Date.now() + 120000; // the whole guessing phase gets two minutes
  for (const href of [...new Set(guesses)].slice(0, 6)) {
    if (Date.now() > guessUntil) { tried.push("guessing stopped at the time budget"); break; }
    try { await page.goto(href, { waitUntil: "domcontentloaded", timeout: 15000 }); } catch { continue; }
    const d = await readDoc(page, 8000, readsLikeTerms);
    if (d.note === "wall") { tried.push(`${href} (wall)`); return { href: "", text: "", via: "", tried, walled: true }; }
    // Terms, not the lobby or a 404 shell: reads like terms, is much more than the lobby's text and does not start like it.
    const looksLikeTerms = d.ok && readsLikeTerms(d.text) && d.text.length > lobbyText.length * 0.5 + 1500 && d.text.slice(0, 300) !== lobbyText.slice(0, 300);
    dbg("guess", href, d.ok ? `${d.text.length} chars${looksLikeTerms ? " TERMS" : ""}` : d.note);
    if (looksLikeTerms) return { href: page.url(), text: d.text, via: "guess", tried };
  }
  tried.push(`${guesses.length} sitemap/guessed paths`);
  for (const c of cands.filter((c) => c.score <= 0).slice(0, 2)) { const r = await tryLink(c, true); if (r) return { ...r, via: "promo-terms" }; }
  if (!cands.length && !lobby.clickables.length) tried.unshift("no terms link or text on the lobby");
  return { href: "", text: "", via: "", tried };
}

async function attempt(job, url, country, type) {
  const browser = await connect(country, type);
  try {
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = await context.newPage();
    await page.setViewportSize({ width: 1366, height: 900 });
    const meter = await installBlocklist(page);
    const chain = [];
    page.on("framenavigated", (f) => { if (f === page.mainFrame()) chain.push(f.url()); });
    let status = "ok", httpStatus = 0;
    try {
      const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      httpStatus = resp ? resp.status() : 0;
    } catch (e) { return { status: "load_error", error: clip(e.message, 200), chain }; }
    const text = await settle(page, httpStatus);
    const finalUrl = page.url();
    if (CHALLENGE_TEXT.test(text.slice(0, 2000)) && text.length < 3000) status = "challenge";
    else if (BLOCK_TEXT.test(text.slice(0, 5000))) status = "geo_blocked"; // the page says so
    else if (httpStatus === 403 || httpStatus === 451) status = "blocked_http"; // a bare 403/451: geo-block or bot wall, the page does not say
    else if (TRACKER_HOSTS.test(host(finalUrl))) status = "stuck_on_tracker";
    else if (httpStatus >= 400 || text.length < 200) status = "dead_or_empty";
    // The IP the casino saw is recorded for reached casinos only; a blocked attempt should cost seconds, not a minute.
    const { ip, ip_country } = status === "ok" ? await whereAmI(context) : { ip: "", ip_country: "" };
    const base = { status, finalUrl, chain, ip, ip_country, httpStatus };
    if (status !== "ok") return base;

    // The lobby and its footer; a page that only asks for a country (unibet.com) is followed to the regional site.
    let lobby = await readLobby(page);
    // A lobby with almost no links did not render (Rokubet via some exits stays a blank shell): let the next country try.
    if (lobby.links.length < 5 && lobby.footer.length < 1500) return { ...base, status: "dead_or_empty", error: "lobby did not render" };
    const regional = regionalSites(lobby.links, lobby.url, country);
    if (!termsCandidates(lobby.links, lobby.url).length && !lobby.clickables.length && regional.length) {
      try {
        await page.goto(regional[0], { waitUntil: "domcontentloaded", timeout: 45000 });
        await settle(page);
        lobby = await readLobby(page);
        base.finalUrl = lobby.url;
      } catch { /* the first lobby stands */ }
    }
    const docs = [{ label: "footer", text: lobby.footer }];
    const terms = await fetchTerms(page, lobby);
    if (terms.text) docs.push({ label: `terms ${terms.href}${terms.via !== "link" ? ` (via ${terms.via})` : ""}`, text: terms.text.slice(0, 250000) });
    for (const p of otherDocs(lobby.links, lobby.url, terms.href ? [terms.href] : [])) {
      try {
        await page.goto(p.href, { waitUntil: "domcontentloaded", timeout: 45000 });
        const d = await readDoc(page);
        docs.push({ label: `${p.kind} ${p.href}`, text: d.text.slice(0, 250000) });
      } catch (e) { docs.push({ label: `${p.kind} ${p.href} (failed: ${clip(e.message, 80)})`, text: "" }); }
    }
    return { ...base, finalUrl: base.finalUrl, footer: lobby.footer, docs, termsTried: terms.tried, walled: !!terms.walled, mb: meter.bytes / 1048576 };
  } finally { await Promise.race([browser.close().catch(() => {}), sleep(10000)]); } // a session Browserless already killed may never answer
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
    const tag = (c) => `${phase.type === "datacenter" ? "dc-" : ""}${c}`;
    let walls = 0;
    for (const c of phase.countries) {
      if (tried.length >= 10) break outer; // ten sessions is the budget for one casino, across phases and URLs
      tried.push(`${tag(c)}${u === 0 ? "" : "(" + (url === resolved ? "resolved" : "domain") + ")"}`);
      try { r = await attempt(job, url, c, phase.type); } catch (e) { r = { status: "connect_error", error: clip(e.message.replace(TOKEN, "***"), 200) }; }
      mbTotal += r.mb || 0;
      if (r.status === "ok") {
        if (hasTerms(r)) break outer;
        fallback ??= { r, exit: tried[tried.length - 1] };
        if (++noTerms >= 3) break outer; // two more exits is enough to tell a wall from a walled exit
        continue;
      }
      // A bare 403/451 is tried from every country: Rokubet refuses Canada and Germany but serves New Zealand, and
      // a blocked session costs little. Only a challenge page (bot wall, not geo) is the same from everywhere.
      if (r.status === "challenge" && ++walls >= 2) break;
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
          try { r = await attempt(job, url, "direct", phase.type); } catch (e) { r = { status: "connect_error", error: clip(e.message.replace(TOKEN, "***"), 200) }; }
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
    const row = await Promise.race([
      run(job).catch((e) => ({ ...base, status: "crash", error: clip(e.message, 200) })),
      sleep(CASINO_BUDGET).then(() => ({ ...base, status: "timeout", error: `no result within ${CASINO_BUDGET / 60000} min` })),
    ]);
    appendFileSync(OUT, stringify([COLUMNS.map((c) => row[c] ?? "")]));
    console.log(`[${++n}/${jobs.length}] ${job.id} ${job.casino} -> ${row.status} ${row.final_domain || ""} ${row.exit_country || ""} ${Math.round((Date.now() - t0) / 1000)}s ${row.mb || 0}MB`);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
clearInterval(keepalive);
if (next < jobs.length) console.log(`deadline reached: ${jobs.length - next} casinos of this shard not started; run again with previous_run_id to continue`);
process.exit(0); // hung sessions from timed-out casinos must not keep the shard alive
