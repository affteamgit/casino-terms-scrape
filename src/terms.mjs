// Reads a casino: the lobby and its footer, the terms search, and documents. No sessions or jobs here: scrape.mjs
// opens the browser, probe-jev.mjs opens a local one, and the tests call the pure parts.
import { termsCandidates, registrable, isPdf } from "./links.mjs";
import { hiddenTextInPage, preferHidden } from "./doctext.mjs";
import { pdfText } from "./pdf.mjs";
import { askJev, linkEntries, termsLinkQuestions, jevPicks, linkSummary, termsPageQuestion, acceptsPage, pageSummary } from "./jev.mjs";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
export const clip = (s, n) => (s || "").replace(/\s+/g, " ").trim().slice(0, n);

export const CHALLENGE_TEXT = /just a moment|checking your browser|verify you are human|cf-chl|attention required/i;

export async function bodyText(page) {
  return page.evaluate(() => document.body ? document.body.innerText : "").catch(() => "");
}

// A bare 403/451 is the casino's answer, not a page still loading: it is read once, without the idle and challenge waits.
export async function settle(page, httpStatus = 0) {
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

// Single-page lobbies render their footer late and load more games as you scroll: scroll to the bottom until a
// terms link is present or the set of links stops changing, up to ~30 s. Then collect the footer text, every
// anchor (with whether it sits in the footer) and, for apps that route from plain elements with a click handler
// instead of anchors (Lebull's footer), the short texts that read like a terms link, marked so they can be clicked.
const CLICK_TEXT = "terms|conditions|t\\s*&\\s*c|\\btos\\b|user[-\\s]agreement|termos|condi[cç][õo]es|condiciones|bedingungen|\\bagb\\b|r[eè]gles|regulamin";
export async function readLobby(page) {
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
export const DOC_WALL = /WAF Block|Performing security verification|Just a moment|Attention Required|Access Denied|Checking your browser|verify you are human/i;
const DOC_LOADING = /\bloading\b/i;
// A page whose first few hundred words are mostly the same token is a font-measurement or skeleton placeholder
// ("word word word …" on Winoly), not content.
const placeholder = (t) => new Set(t.slice(0, 3000).toLowerCase().split(/\s+/)).size < 40;
// The general terms talk about terms throughout; a help-centre home page or a promotion card does not.
const TERMS_WORDS = /\bterms?\b|\bconditions?\b|agreement|termos|condi[cç]|\bagb\b|bedingungen|r[eè]gles|regulamin|условия|правила|şartlar|villkor|vilkår|ehdot|voorwaarden/gi;
export const readsLikeTerms = (t) => t.length >= 2000 && (t.match(TERMS_WORDS) || []).length >= 5;
// `want` says what a finished document looks like; until the text satisfies it the wait goes on, since a shell
// with only the navigation is stable long before the document itself arrives (NetBet's help pages). Text that has
// stopped changing and still does not satisfy it may be in the page but collapsed (SoftSwiss accordions): then the
// hidden text is read, and used when it is the document.
export async function readDoc(page, budget = 25000, want = (t) => t.length >= 500) {
  const t0 = Date.now();
  let lastLen = -1, seenLen = -1, wallSince = 0;
  const hidden = async (t) => {
    const h = await page.evaluate(hiddenTextInPage).catch(() => "");
    return preferHidden(t, h) && !placeholder(h) && want(h) ? h : "";
  };
  while (Date.now() - t0 < budget) {
    const t = await bodyText(page);
    const head = t.slice(0, 1500);
    // A bot wall that has not cleared in 12 s will not: give up early, the caller moves on.
    if (DOC_WALL.test(head)) { wallSince ||= Date.now(); if (Date.now() - wallSince > 12000) return { ok: false, text: t, note: "wall" }; } else wallSince = 0;
    const settled = t.length === seenLen;
    seenLen = t.length;
    if (t.length >= 500 && !DOC_WALL.test(head) && !DOC_LOADING.test(t.slice(0, 400)) && !placeholder(t) && want(t)) {
      if (t.length === lastLen) return { ok: true, text: t };
      lastLen = t.length;
    } else if (settled && !DOC_WALL.test(head)) {
      const h = await hidden(t);
      if (h) return { ok: true, text: h, hidden: true };
    }
    await sleep(1500);
  }
  const t = await bodyText(page);
  const wall = DOC_WALL.test(t.slice(0, 1500));
  if (!wall) { const h = await hidden(t); if (h) return { ok: true, text: h, hidden: true }; }
  return { ok: t.length >= 500 && !wall && !placeholder(t), text: t, note: wall ? "wall" : t.length < 500 ? "thin" : placeholder(t) ? "placeholder" : "still loading" };
}

/** Clicks what looks like a collapsed section header; returns how many were opened. */
export async function expandSections(page) {
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
export const dbg = (...a) => { if (process.env.DEBUG) console.error("[debug]", ...a); };
export async function fetchTerms(page, lobby, jev = { notes: [] }) {
  const tried = [];
  let cands = termsCandidates(lobby.links, lobby.url);
  // Jev reads the footer once: its picks (when it is confident a terms link exists) go ahead of the scored anchors.
  // The page read validates every candidate, so a wrong pick costs one page load; no key or an error changes nothing.
  // "off" is noted once however many questions went unasked.
  const note = (s) => { if (s !== "off" || !jev.notes.includes("off")) jev.notes.push(s); };
  const entries = linkEntries(lobby);
  let picks = [];
  if (entries.length) {
    try {
      const q = termsLinkQuestions(entries);
      const answers = await askJev(q.state, q.questions);
      picks = jevPicks(answers, entries);
      note(linkSummary(answers));
    } catch (e) { note(`error:${clip(e.message, 60)}`); }
  }
  const jevLinks = picks.filter((p) => p.kind === "link").map((p) => ({ href: p.href, text: p.text, footer: p.in_footer, score: 99, jev: true }));
  cands = [...jevLinks, ...cands.filter((c) => !jevLinks.some((j) => j.href === c.href))];
  const jevTexts = picks.filter((p) => p.kind === "text").map((p) => p.text);
  lobby = { ...lobby, clickables: [...lobby.clickables.filter((c) => jevTexts.includes(c.text)), ...lobby.clickables.filter((c) => !jevTexts.includes(c.text))] };
  dbg("jev", jev.notes[jev.notes.length - 1] || "off", "picks:", picks.map((p) => `${p.p.toFixed(2)} ${p.kind} "${p.text}" ${p.href}`).join(" | "));
  // Pages Jev has judged in this search, by URL: a candidate is judged once.
  const judged = new Map();
  const isTermsPage = async (text, meta) => {
    if (readsLikeTerms(text)) return true; // the pattern is the fast accept; Jev reads what it rejects
    if (text.length < 1500 || DOC_WALL.test(text.slice(0, 1500))) return false;
    if (!judged.has(meta.url)) judged.set(meta.url, (async () => {
      try {
        const q = termsPageQuestion({ ...meta, text });
        const answers = await askJev(q.state, q.questions);
        note(pageSummary(answers));
        dbg("jev page", meta.url, pageSummary(answers));
        return acceptsPage(answers);
      } catch (e) { note(`error:${clip(e.message, 60)}`); return false; }
    })());
    return judged.get(meta.url);
  };
  const pageMeta = () => page.evaluate(() => ({ url: location.href, title: document.title, headings: [...document.querySelectorAll("h1, h2, h3")].map((h) => h.innerText.trim()).filter(Boolean) })).catch(() => ({ url: page.url(), title: "", headings: [] }));
  dbg(lobby.url, `${lobby.links.length} links, candidates:`, cands.slice(0, 6).map((c) => `${c.score} ${c.href} "${c.text.slice(0, 30)}"`).join(" | "), "clickables:", lobby.clickables.map((c) => `"${c.text}"${c.footer ? "(footer)" : ""}`).join(" | "));
  // A PDF is fetched as bytes and read in Node. page.request shares the session's cookies but not its proxy: it
  // leaves from this process (the VPN locally, the Actions runner on Browserless), which the file hosts allow.
  const tryPdf = async (c, lenient) => {
    try {
      const r = await page.request.get(c.href, { timeout: 30000 });
      if (!r.ok()) throw new Error(`http ${r.status()}`);
      const body = await r.body();
      if (body.length > 20 * 1048576) throw new Error("over 20 MB");
      const text = await pdfText(body);
      const good = text.length >= 500 && (lenient || await isTermsPage(text, { url: c.href, title: "", headings: [] }));
      dbg("pdf", c.href, good ? `ok ${text.length} chars` : `${text.length} chars, not terms-like`);
      if (good) return { href: c.href, text, via: "link", pdf: true, tried };
      tried.push(`${c.href} (${text.length < 500 ? "pdf thin" : "pdf not terms-like"})`);
    } catch (e) { tried.push(`${c.href} (pdf unreadable: ${clip(e.message, 50)})`); }
    return null;
  };
  const tryLink = async (c, lenient = false) => {
    if (isPdf(c.href)) return tryPdf(c, lenient);
    let resp;
    try { resp = await page.goto(c.href, { waitUntil: "domcontentloaded", timeout: 45000 }); } catch (e) {
      // A PDF served without a .pdf extension makes Chromium start a download instead of rendering.
      if (/Download is starting/i.test(e.message)) return tryPdf(c, lenient);
      tried.push(`${c.href} (${clip(e.message, 60)})`); return null;
    }
    if (/application\/pdf/i.test((resp && resp.headers()["content-type"]) || "")) return tryPdf({ ...c, href: page.url() }, lenient);
    let d = await readDoc(page, 35000, lenient ? undefined : readsLikeTerms); // BangaWin bounces through an auth callback for ~20 s before the text arrives
    // A terms page laid out as an accordion shows only its section titles (SoftSwiss "/rules" pages): open every
    // collapsed section and read again.
    if (!d.ok || !readsLikeTerms(d.text)) { if (await expandSections(page)) d = await readDoc(page, 10000, lenient ? undefined : readsLikeTerms); }
    const good = d.ok && (lenient || await isTermsPage(d.text, await pageMeta()));
    dbg("link", c.href, good ? `ok ${d.text.length} chars` : d.ok ? "not terms-like" : d.note);
    if (good) return { href: page.url(), text: d.text, via: c.jev ? "jev" : "link", hidden: !!d.hidden, tried };
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
      if ((navigated ? d.ok : grew) && await isTermsPage(d.text, await pageMeta())) return { href: navigated ? page.url() : `${lobby.url}#"${c.text}"`, text: d.text, via: "click", hidden: !!d.hidden, tried };
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
    const looksLikeTerms = d.ok && d.text.length > lobbyText.length * 0.5 + 1500 && d.text.slice(0, 300) !== lobbyText.slice(0, 300) && (await isTermsPage(d.text, await pageMeta()));
    dbg("guess", href, d.ok ? `${d.text.length} chars${looksLikeTerms ? " TERMS" : ""}` : d.note);
    if (looksLikeTerms) return { href: page.url(), text: d.text, via: "guess", hidden: !!d.hidden, tried };
  }
  tried.push(`${guesses.length} sitemap/guessed paths`);
  for (const c of cands.filter((c) => c.score <= 0).slice(0, 2)) { const r = await tryLink(c, true); if (r) return { ...r, via: "promo-terms" }; }
  if (!cands.length && !lobby.clickables.length) tried.unshift("no terms link or text on the lobby");
  return { href: "", text: "", via: "", tried };
}
