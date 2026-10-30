// Shows why a casino page yields no terms: opens it through Browserless like scrape.mjs does and prints, step by
// step, what the DOM holds (anchors, footer, terms-like links with their raw hrefs) and, with --follow, how the
// terms page's text grows over time. --probe-countries instead tries every exit country (and direct) once and
// reports whether the proxy tunnels to the domain and what the page looks like.
// Usage: BROWSERLESS_TOKEN=... node src/diagnose.mjs <url> [--country ca|direct] [--follow] [--probe-countries]
import { chromium } from "playwright-core";

const arg = (name, d) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : d; };
const URL_ = process.argv[2];
const COUNTRY = arg("--country", "ca");
const TOKEN = process.env.BROWSERLESS_TOKEN;
const REGION = process.env.BROWSERLESS_REGION || "production-sfo";
const COUNTRIES = (process.env.EXIT_COUNTRIES || "ca,de,nz,fi,ie,br,jp,in").split(",");
if (!TOKEN || !URL_) throw new Error("usage: BROWSERLESS_TOKEN=... node src/diagnose.mjs <url> [--country ca] [--follow] [--probe-countries]");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clip = (s, n) => (s || "").replace(/\s+/g, " ").trim().slice(0, n);
const wsUrl = (country) => {
  const p = new URLSearchParams({ token: TOKEN, stealth: "true", timeout: "240000" });
  if (country !== "direct") { p.set("proxy", process.env.PROXY_TYPE || "residential"); p.set("proxyCountry", country); p.set("proxySticky", "true"); }
  return `wss://${REGION}.browserless.io?${p}`;
};
const BLOCKED_TYPES = new Set(["image", "media", "font", "imageset", "texttrack", "manifest"]);
const BLOCKED_HOSTS = /google-analytics|googletagmanager|doubleclick|facebook\.net|facebook\.com\/tr|hotjar|clarity\.ms|intercom|livechatinc|zendesk|tawk\.to|sentry\.io|segment\.(io|com)|mixpanel|amplitude|optimizely|onesignal|pusher|youtube|vimeo|\.mp4(\?|$)|\.webm(\?|$)|\.gif(\?|$)/i;

async function open(country) {
  const browser = await chromium.connectOverCDP(wsUrl(country), { timeout: 45000 });
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const page = await context.newPage();
  await page.setViewportSize({ width: 1366, height: 900 });
  if (!process.argv.includes("--no-block")) await page.route("**/*", (route) => (BLOCKED_TYPES.has(route.request().resourceType()) || BLOCKED_HOSTS.test(route.request().url()) ? route.abort() : route.continue())).catch(() => {});
  return { browser, page };
}

const snapshot = (page) => page.evaluate(() => {
  const links = [...document.querySelectorAll("a[href]")];
  const termsLike = links.filter((a) => /terms|conditions|t\s*&\s*c|\btos\b|termos|condições|bedingungen|agb/i.test(a.innerText + " " + a.getAttribute("href")))
    .slice(0, 12).map((a) => ({ text: (a.innerText || a.getAttribute("aria-label") || "").trim().slice(0, 50), raw: (a.getAttribute("href") || "").slice(0, 100), href: a.href.slice(0, 120) }));
  const f = document.querySelector("footer, [class*=footer i], #footer");
  return { ready: document.readyState, textLen: document.body ? document.body.innerText.length : 0, anchors: links.length, anchorsNoHref: document.querySelectorAll("a:not([href])").length,
    footer: f ? `${f.tagName.toLowerCase()}.${(f.className || "").toString().slice(0, 40)} textLen=${f.innerText.length} links=${f.querySelectorAll("a[href]").length}` : "none",
    termsLike, scrollH: document.body.scrollHeight, title: document.title.slice(0, 60) };
}).catch((e) => ({ error: e.message }));

if (process.argv.includes("--probe-countries")) {
  for (const c of [...COUNTRIES, "direct"]) {
    const t0 = Date.now();
    let browser;
    try {
      ({ browser } = await open(c));
      const page = browser.contexts()[0].pages()[0];
      const resp = await page.goto(URL_, { waitUntil: "domcontentloaded", timeout: 45000 });
      await sleep(5000);
      const s = await snapshot(page);
      console.log(`${c.padEnd(6)} http=${resp ? resp.status() : 0} final=${page.url().slice(0, 60)} text=${s.textLen} anchors=${s.anchors} termsLinks=${s.termsLike.length} footer=${s.footer} | ${clip(await page.evaluate(() => document.body.innerText), 120)} (${Math.round((Date.now() - t0) / 1000)}s)`);
    } catch (e) { console.log(`${c.padEnd(6)} ERROR ${clip(e.message.replace(TOKEN, "***"), 160)} (${Math.round((Date.now() - t0) / 1000)}s)`); }
    finally { await browser?.close().catch(() => {}); }
  }
  process.exit(0);
}

const { browser, page } = await open(COUNTRY);
// --bytes: what goes through the proxy, by resource type and by host, so the blocklist can be aimed at it.
const bytes = { byType: {}, byHost: {}, byExt: {}, total: 0, n: 0 };
if (process.argv.includes("--bytes")) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  const meta = new Map();
  cdp.on("Network.responseReceived", (e) => meta.set(e.requestId, { type: e.type, url: e.response.url, mime: e.response.mimeType }));
  cdp.on("Network.webSocketFrameReceived", (e) => { const n = (e.response?.payloadData || "").length; bytes.total += n; bytes.n++; bytes.byType.WebSocket = (bytes.byType.WebSocket || 0) + n; bytes.byHost["(websocket frames)"] = (bytes.byHost["(websocket frames)"] || 0) + n; });
  cdp.on("Network.loadingFinished", (e) => {
    const m = meta.get(e.requestId); if (!m) return;
    const n = e.encodedDataLength || 0, h = (() => { try { return new URL(m.url).hostname; } catch { return "?"; } })();
    const ext = (m.url.match(/\.([a-z0-9]{2,5})(?:\?|$)/i) || [, m.mime])[1];
    bytes.total += n; bytes.n++;
    bytes.byType[m.type] = (bytes.byType[m.type] || 0) + n; bytes.byHost[h] = (bytes.byHost[h] || 0) + n; bytes.byExt[ext] = (bytes.byExt[ext] || 0) + n;
  });
}
const top = (o, k = 12) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, k).map(([a, b]) => `${a} ${(b / 1048576).toFixed(2)}MB`).join(" | ");
process.on("exit", () => { if (process.argv.includes("--bytes")) { console.log(`BYTES total ${(bytes.total / 1048576).toFixed(2)}MB in ${bytes.n} responses`); console.log("  by type:", top(bytes.byType)); console.log("  by ext/mime:", top(bytes.byExt)); console.log("  by host:", top(bytes.byHost)); } });
if (process.argv.includes("--network")) {
  page.on("requestfailed", (r) => console.log(`  [failed] ${r.resourceType()} ${r.url().slice(0, 110)} ${r.failure()?.errorText || ""}`));
  page.on("response", (r) => { if (r.status() >= 400) console.log(`  [${r.status()}] ${r.request().resourceType()} ${r.url().slice(0, 110)}`); });
  page.on("framenavigated", (f) => { if (f === page.mainFrame()) console.log(`  [nav] ${f.url().slice(0, 120)}`); });
}
try {
  const t0 = Date.now();
  const resp = await page.goto(URL_, { waitUntil: "domcontentloaded", timeout: 60000 }).catch((e) => { console.log("goto error:", clip(e.message, 160)); return null; });
  console.log(`http=${resp ? resp.status() : 0} url=${page.url()}`);
  for (let i = 0; i < 6; i++) {
    const s = await snapshot(page);
    console.log(`t=${Math.round((Date.now() - t0) / 1000)}s ready=${s.ready} text=${s.textLen} anchors=${s.anchors} (no-href ${s.anchorsNoHref}) footer=${s.footer} scrollH=${s.scrollH} title="${s.title}"`);
    for (const l of s.termsLike || []) console.log(`    terms-like: "${l.text}" raw="${l.raw}" -> ${l.href}`);
    if (s.error) console.log("    snapshot error:", clip(s.error, 120));
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
    await sleep(3000);
  }
  if (process.argv.includes("--frames")) console.log("frames:", page.frames().map((f) => (f === page.mainFrame() ? "[main] " : "[sub] ") + f.url().slice(0, 90)).join(" | "));
  const hold = Number(arg("--hold", 0));
  if (hold) { console.log(`holding ${hold}s with the lobby open`); const b0 = bytes.total; await sleep(hold * 1000); console.log(`  bytes during hold: ${((bytes.total - b0) / 1048576).toFixed(2)}MB (websocket so far ${((bytes.byType.WebSocket || 0) / 1048576).toFixed(2)}MB)`); }
  const body = await page.evaluate(() => document.body.innerText).catch(() => "");
  console.log("body head:", clip(body, 300));
  console.log("body tail:", clip(body.slice(-400), 400));
  if (process.argv.includes("--text")) console.log("FULL TEXT:", body.replace(/\s+/g, " "));
  if (process.argv.includes("--clickables")) {
    const c = await page.evaluate(() => {
      const re = /terms|conditions|t\s*&\s*c|\btos\b|termos|condi[cç][õo]es|condiciones|bedingungen|\bagb\b/i;
      const out = [];
      for (const el of document.querySelectorAll("footer *, [class*=footer i] *, nav *, [class*=menu i] *, li, span, div, p, button")) {
        const text = (el.innerText || "").trim(), tc = (el.textContent || "").trim();
        if (!re.test(text) && !re.test(tc)) continue;
        if (tc.length > 60) continue;
        out.push(`${el.tagName.toLowerCase()} children=${el.children.length} innerText=${JSON.stringify(text.slice(0, 40))} textContent=${JSON.stringify(tc.slice(0, 40))} inA=${!!el.closest("a[href]")} inFooter=${!!el.closest("footer, [class*=footer i], #footer")} visible=${!!(el.offsetWidth || el.offsetHeight)}`);
        if (out.length >= 15) break;
      }
      const f = document.querySelector("footer, [class*=footer i], #footer");
      return { footer: f ? f.innerText.length : -1, hasTermsText: /terms/i.test(document.body.innerText), out };
    }).catch((e) => ({ error: e.message }));
    console.log("clickables probe:", JSON.stringify(c, null, 1));
  }
  if (process.argv.includes("--links")) {
    const all = await page.evaluate(() => [...document.querySelectorAll("a, button")].map((a) => `${a.tagName.toLowerCase()} "${(a.innerText || a.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 40)}" -> ${a.getAttribute("href") || "-"}`)).catch(() => []);
    console.log(`all links/buttons (${all.length}):`); for (const l of all.slice(0, 120)) console.log("   ", l.slice(0, 140));
  }
  if (process.argv.includes("--follow")) {
    const s = await snapshot(page);
    const best = (s.termsLike || []).find((l) => /terms|conditions|termos/i.test(l.raw) && !/privacy|cookie/i.test(l.raw + l.text)) || (s.termsLike || [])[0];
    if (!best) console.log("no terms link to follow");
    else {
      console.log(`following ${best.href}`);
      const t1 = Date.now();
      const r2 = await page.goto(best.href, { waitUntil: "domcontentloaded", timeout: 45000 }).catch((e) => { console.log("goto error:", clip(e.message, 160)); return null; });
      console.log(`http=${r2 ? r2.status() : 0} url=${page.url()}`);
      for (let i = 0; i < 10; i++) {
        const t = await page.evaluate(() => document.body.innerText).catch(() => "");
        console.log(`  t=${Math.round((Date.now() - t1) / 1000)}s text=${t.length} | ${clip(t, 140)}`);
        if (t.length > 8000) break;
        await sleep(2000);
      }
    }
  }
} finally { await browser.close().catch(() => {}); }
