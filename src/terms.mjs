// Reads a casino: the lobby and its footer, the terms search, and documents. No sessions or jobs here: scrape.mjs
// opens the browser, probe-jev.mjs opens a local one, and the tests call the pure parts.
import { termsCandidates, registrable, isPdf, docLinks, withinDomain, siblingGuesses, namedTermsPage, TERMS_TEXT } from "./links.mjs";
import { hiddenTextInPage, preferHidden } from "./doctext.mjs";
import { pdfText } from "./pdf.mjs";
import { askJev, jevEnabled, linkEntries, termsLinkQuestions, jevPicks, linkSummary, termsPageQuestion, acceptsPage, pageSummary } from "./jev.mjs";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
export const clip = (s, n) => (s || "").replace(/\s+/g, " ").trim().slice(0, n);

export const CHALLENGE_TEXT = /just a moment|checking your browser|verify you are human|cf-chl|attention required|human verification|performing security verification/i;
export const TRACKER_HOSTS = /(^|\.)(casino\.guru|askgamblers\.com|lcb\.org)$/i;
export const BLOCK_TEXT = /not (available|accessible) (in|from) your (country|region|location)|access (is )?(denied|restricted)|restricted (country|region|territor)|can(?:'|no)t access from this country|unavailable in your (country|region)|we do not accept players from|your country is (blocked|restricted)|403 forbidden|error 1020|sorry, you have been blocked/i;
// A short page that says the site is down for maintenance (thestakehouse.io): the casino is not reached this time.
const MAINTENANCE_TEXT = /under maintenance|maintenance mode|down for maintenance|we(?:'|’)ll be back (soon|shortly)|back in a (few|couple of) (minutes|hours)/i;

/**
 * What the first page says about reaching the casino. The checks run in this order: a domain marketplace's address,
 * a bot check (whatever the HTTP code: lumocasino answers 405 with "Human Verification"), a page that says the country
 * is blocked, a bare 403/451, a tracker that never redirected, a for-sale page, a maintenance page (`links`: the
 * page's anchors; a page with ten or more, or with a terms link on its own domain, is not one), and last an
 * error code or an empty page. Anything else is "ok".
 */
export function lobbyStatus({ text, httpStatus = 0, finalUrl = "", links = [] }) {
  if (isParkedUrl(finalUrl)) return "parked"; // a domain marketplace answers for it, whatever it says
  if (CHALLENGE_TEXT.test(text.slice(0, 2000)) && text.length < 3000) return "challenge";
  if (BLOCK_TEXT.test(text.slice(0, 5000))) return "geo_blocked"; // the page says so
  if (httpStatus === 403 || httpStatus === 451) return "blocked_http"; // a bare 403/451: geo-block or bot wall, the page does not say
  if (TRACKER_HOSTS.test(host(finalUrl))) return "stuck_on_tracker";
  if (isParked(text)) return "parked"; // a for-sale page, not a casino
  // Maintenance is a bare page: a lobby with a "live casino under maintenance" banner has its links and its terms.
  if (text.length < 3000 && MAINTENANCE_TEXT.test(text) && links.length < 10 && !termsCandidates(links, finalUrl).some((c) => c.score >= 5 && withinDomain(host(c.href), registrable(host(finalUrl))))) return "maintenance";
  if (httpStatus >= 400 || text.length < 200) return "dead_or_empty";
  return "ok";
}

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

// A cookie banner can cover the footer, and on some lobbies (bet25.dk) the consent text is all the page shows until it
// is accepted. Only a button inside something that calls itself a cookie, consent or GDPR element is clicked.
const CONSENT_TEXT = "^(accept( all| cookies| all cookies)?|agree|i agree|got it!?|ok(ay)?|allow( all)?( cookies)?|consent|continue|accepter( alle| tout| alt)?|tillad( alle)?( cookies)?|tout accepter|alles accepteren|akzeptieren|alle akzeptieren|godkend( alle)?|hyväksy( kaikki)?|aceptar( todo)?|accetta( tutto)?|aceitar( todos)?|zgadzam się|accepteren|acceptera( alla)?|godta( alle)?)$";
// Runs inside the page: is this element part of a cookie banner? The nearest ancestor that calls itself a cookie,
// consent or GDPR element counts only when it is a banner-sized thing: not <body> or <html> (WordPress Cookie Notice
// puts "cookies-not-set" on body), not a registration or login form ("consent" boxes), and not a wrapper around the
// page: a long container that holds the page's own footer or main content. A dialog's own <header>, <nav> or
// "page-footer" part (Cookie Information's .coi-banner__page-footer) does not make it a wrapper: only <footer>, #footer,
// <main>, role=contentinfo, a class that is exactly "footer", or a footer-named element with 3+ links does.
// `memo` is a Map the caller makes once per evaluate, so a verdict is not kept on the page's nodes.
export function inBannerInPage(el, memo) {
  const SEL = "[class*=cookie i], [id*=cookie i], [class*=consent i], [id*=consent i], [class*=gdpr i], [id*=gdpr i], [aria-label*=cookie i]";
  const isWrapper = (c) => (c.innerText || "").length > 3000
    && !![...c.querySelectorAll("footer, #footer, main, [role=contentinfo], [class~=footer], [class*=footer i]")].find((f) => f.matches("footer, #footer, main, [role=contentinfo], [class~=footer]") || f.querySelectorAll("a[href]").length >= 3);
  for (let c = el.closest(SEL); c; c = c.parentElement && c.parentElement.closest(SEL)) {
    if (c === document.body || c === document.documentElement) continue;
    if (!memo.has(c)) memo.set(c, !c.querySelector("input[type=password]") && ![...c.querySelectorAll("form")].some((f) => f.querySelectorAll("input").length >= 3) && !isWrapper(c));
    if (memo.get(c)) return true;
  }
  return false;
}
export async function dismissCookies(page) {
  const find = (re, inBannerFn) => {
    const r = new RegExp(re, "i"), memo = new Map();
    const btn = [...document.querySelectorAll("button, a, [role=button]")].find((el) => inBannerFn(el, memo) && r.test((el.innerText || "").trim().replace(/\s+/g, " ")));
    if (!btn) return false;
    btn.click();
    return true;
  };
  return page.evaluate(`(${find})(${JSON.stringify(CONSENT_TEXT)}, ${inBannerInPage})`).catch(() => false);
}

// A parked or for-sale domain is not a casino: it gets its own status so it does not count as reached.
export const PARKED_TEXT = /domain( name)?( [\w.-]+)? (is )?(now )?for sale|buy this domain|this domain (is |has been )?(parked|registered)|parked (free|domain)|godaddy operating company|sedo\.com|\bdan\.com\b|afternic|hugedomains|domain (has )?expired|make an offer/i;
export const isParked = (text) => text.length < 6000 && PARKED_TEXT.test(text.slice(0, 3000));
// Some for-sale pages refuse the scraper (godaddy's says "Access Denied"), so the address itself is also read:
// a domain marketplace or parking service is not a casino whatever it answers.
const PARKED_HOST = /(^|\.)(sedo\.com|sedoparking\.com|dan\.com|afternic\.com|hugedomains\.com|parkingcrew\.net|bodis\.com|undeveloped\.com)$|^forsale\.|^parked\./i;
export const isParkedUrl = (u) => { try { return PARKED_HOST.test(new URL(u).hostname); } catch { return false; } };
// A for-sale lander served on the casino's own domain (betfunk.com, scoobybet.com: Dan.com listings) links the
// marketplace's own terms and privacy pages. A marketplace's legal pages are never a casino's terms.
const MARKETPLACE_HOST = /(^|\.)(dan\.com|sedo\.com|godaddy\.com|afternic\.com|hugedomains\.com|undeveloped\.com|namecheap\.com|bodis\.com|parkingcrew\.net|sedoparking\.com)$/i;
const marketplaceOf = (u) => { try { const m = MARKETPLACE_HOST.exec(new URL(u).hostname); return m ? m[2].toLowerCase() : ""; } catch { return ""; } };
export const isMarketplaceUrl = (u) => !!marketplaceOf(u);
/**
 * The marketplace whose terms or privacy page the lobby links, or "": such a lobby is a for-sale listing. As with
 * notCasino, a lobby that links its own terms (a candidate of score 5 or more on its domain) is a casino.
 */
export function marketplaceLobby(links, pageUrl = "") {
  const own = registrable(host(pageUrl));
  if (own && termsCandidates(links, pageUrl).some((c) => c.score >= 5 && withinDomain(host(c.href), own))) return "";
  for (const l of links) {
    const m = marketplaceOf(l.href);
    if (!m) continue;
    let p = "";
    try { p = new URL(l.href).pathname; } catch { /* not a URL */ }
    if (TERMS_TEXT.test(l.text || "") || /privacy|legal|terms/i.test(`${l.text || ""} ${p}`)) return m;
  }
  return "";
}

// A review or affiliate site is not a casino either. The disclaimer has to be on the lobby itself, and a lobby that
// links its own terms (a candidate of score 5 or more on the casino's domain) is a casino with an affiliate page.
export const NOT_CASINO_TEXT = /independent review site|does not (run|operate) any casino|we may earn a commission|affiliate disclosure|(casino|slots?) review sites?\b|how we (rate|review|rank|test)( and (rate|review|rank|test))? (online )?casinos/i;
export function notCasino(text, cands, pageUrl) {
  const m = NOT_CASINO_TEXT.exec(text);
  if (!m) return "";
  const own = registrable(host(pageUrl));
  if (cands.some((c) => c.score >= 5 && withinDomain(host(c.href), own))) return "";
  return m[0].toLowerCase();
}

/**
 * Is a text the lobby's own? An in-place click that opens nothing leaves the lobby's hidden text, which reads like
 * anything the lobby says about terms; a guessed path that an app routes to the lobby shows the lobby again. Three rules:
 * the same first 2,000 characters; a length within 5% of the lobby's; and (deliberately, beyond the brief) the same
 * first 500 characters, for a lobby whose text grew a little since it was measured.
 */
// The words of a promotion's terms: a bonus, a campaign, wagering, free spins (with the Nordic words the exit sees).
export const PROMO_OPENING = /bonus|promotion|\bpromo\b|campaign|wager|free ?spins?|welcome (offer|package)|cashback|reload|tournament|kampanj|omsetningskrav|gratisspinn/i;
/**
 * May a document opened in place (a modal, a tab) be accepted on the terms pattern alone? Only when the first short
 * line (80 chars or less, among its first five) that is not UI noise names the general terms and no promotion, and its
 * first 300 characters hold fewer than two distinct promotion words. Noise is a line whose words are all without
 * letters (×, a date) or known UI words (Close, New, Menu), or an update stamp. Anything else (a "Cash Race" or "Spooky Friday" modal, even with
 * a "Terms and conditions" sub-heading; no heading at all; a bonus's terms under a terms heading) is for Jev only.
 */
const UI_WORD = /^(x|close|lukk|stäng|sulje|luk|schließen|fermer|cerrar|chiudi|fechar|back|tilbake|new|ny|nytt|uusi|neu|menu|share|print|download)$/i;
const UPDATE_STAMP = /^((last )?updated?|sist oppdatert|version)\b/i;
// Read as letter runs: two buttons render as "×Close" with no space between them.
const noise = (l) => UPDATE_STAMP.test(l) || l.split(/[^\p{L}]+/u).filter(Boolean).every((w) => UI_WORD.test(w));
export function fastInPlace(doc) {
  const lines = doc.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 5).filter((l) => l.length <= 80);
  const title = lines.find((l) => !noise(l));
  // Singular and plural are one word ("free spin", "free spins").
  const promoWords = new Set((doc.slice(0, 300).match(new RegExp(PROMO_OPENING.source, "gi")) || []).map((w) => w.toLowerCase().replace(/\s+/g, " ").replace(/s$/, "")));
  return !!title && TERMS_TEXT.test(title) && !PROMO_OPENING.test(title) && promoWords.size < 2;
}
/** The lines a click added to a page: what an in-place document (a modal, a tab) holds, without the page around it. */
export function addedText(after, before) {
  const seen = new Set(before.split("\n").map((l) => l.trim()).filter(Boolean));
  return after.split("\n").filter((l) => !seen.has(l.trim())).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
export const fingerprint = (t) => t.replace(/\s+/g, " ").trim().slice(0, 2000);
export const sameAsLobby = (text, ref) => !!ref.len && (fingerprint(text) === ref.fp || Math.abs(text.length - ref.len) <= ref.len * 0.05 || (ref.fp.length >= 200 && fingerprint(text).startsWith(ref.fp.slice(0, 500))));

// Single-page lobbies render their footer late, some only once it is scrolled into view (betportal.com: ~7 s after
// load), and load more games as you scroll. The page is scrolled to the bottom every second until its anchors and text
// stop growing (see below): 2 s of quiet once a terms link is present, 10 s otherwise, 25 s at most. Then collect the footer text,
// every anchor (with whether it sits in the footer) and, for apps that route from plain elements with a click handler
// instead of anchors (Lebull's footer), the short texts that read like a terms link, marked so they can be clicked:
// plain elements (betportal's <span>Vilkår</span>) and anchors with no real href (koalabet's router links: no href,
// "", "#" or javascript:).
const CLICK_TEXT = `${TERMS_TEXT.source}|\\bregler\\b`;
// A caption that is not the terms link: other policies, a product's rules, and a promotion's "T&Cs apply" or
// "Bonus terms" (a promotion's modal is not the general terms). Not the whole of PROMO: "refer", "registration",
// "challenge" or "drops" also match inside a terms caption ("Registration terms").
const CLICK_SKIP = "privacy|cookie|sport|rules|\\bapply\\b|bonus|promo|offer|welcome|campaign|tournament|free-?\\s?spin|vip\\b|cashback|reload|giveaway|loyalty|lottery";
export const LOBBY_QUIET_MS = 10000, LOBBY_QUIET_TERMS_MS = 2000, LOBBY_MAX_MS = 25000;
export async function readLobby(page, { quietMs = LOBBY_QUIET_MS, quietTermsMs = LOBBY_QUIET_TERMS_MS, maxMs = LOBBY_MAX_MS } = {}) {
  if (await dismissCookies(page)) await sleep(1500);
  const t0 = Date.now();
  // A change is a new anchor count or 300 more characters than the page has shown so far: a ticker of recent wins
  // changes the text all the time without growing it.
  let anchors = -1, maxLen = 0, changed = Date.now();
  while (Date.now() - t0 < maxMs) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
    await sleep(1000);
    const n = await page.evaluate(() => {
      const links = [...document.querySelectorAll("a[href]")];
      return { a: links.length, len: document.body ? document.body.innerText.length : 0, t: links.some((a) => /terms|conditions/i.test(a.innerText + " " + a.getAttribute("href"))) };
    }).catch(() => ({ a: 0, len: 0, t: false }));
    if (n.a !== anchors || n.len >= maxLen + 300) { anchors = n.a; maxLen = Math.max(maxLen, n.len); changed = Date.now(); continue; }
    if (Date.now() - changed >= (n.t ? quietTermsMs : quietMs)) break;
  }
  // Read with the footer in view: some apps mount footer sections only while they are on screen (Lebull's legal
  // links vanished from the DOM once the page was scrolled back to the top).
  const read = (clickRe, skipRe, inBannerFn) => {
    const re = new RegExp(clickRe, "i"), skip = new RegExp(skipRe, "i"), memo = new Map(), inBanner = (el) => inBannerFn(el, memo);
    // A cookie banner's own "footer" is not the page's (bet25.dk's consent dialog has one and the page has none).
    const inFooter = (el) => !!el.closest("footer, [class*=footer i], #footer") && !inBanner(el);
    const f = [...document.querySelectorAll("footer, [class*=footer i], #footer")].find((x) => !inBanner(x));
    const footer = f && f.innerText.length > 80 ? f.innerText : document.body.innerText.slice(-5000);
    const links = [...document.querySelectorAll("a[href]")].map((a) => ({ href: a.href, text: (a.innerText || a.getAttribute("aria-label") || "").trim().slice(0, 80), footer: inFooter(a) }));
    const found = [];
    // An anchor whose href goes nowhere by itself: the app routes it from a click handler.
    const router = (a) => { const h = (a.getAttribute("href") || "").trim(); return h === "" || h === "#" || /^javascript:/i.test(h); };
    for (const el of document.querySelectorAll("[data-cts]")) el.removeAttribute("data-cts"); // marks from an earlier read
    for (const el of document.querySelectorAll("footer *, [class*=footer i] *, nav *, [class*=menu i] *, a, li, span, div, p, button")) {
      const text = (el.innerText || "").trim(), a = el.closest("a[href]");
      if (el.children.length || text.length > 60 || !re.test(text) || skip.test(text) || (a && !router(a))) continue;
      // The same text twice (a promo card's "VILKÅR" and the footer's): the footer's, else the one lower on the page.
      const dup = found.findIndex((c) => c.text.toLowerCase() === text.toLowerCase()), footer = inFooter(el);
      if (dup >= 0) { if (!found[dup].footer || footer) found[dup] = { el, text, footer }; continue; }
      found.push({ el, text, footer });
      if (found.length >= 40) break;
    }
    // The footer's first, in page order; then the rest from the bottom of the page up, so a promo card's "T&Cs apply"
    // near the top does not crowd out the legal links at the bottom.
    const clickables = [...found.filter((c) => c.footer), ...found.filter((c) => !c.footer).reverse()].slice(0, 6).map((c, i) => {
      c.el.setAttribute("data-cts", String(i));
      return { text: c.text, footer: c.footer, sel: `[data-cts="${i}"]` };
    });
    return { url: location.href, footer, links, clickables };
  };
  const lobby = await page.evaluate(`(${read})(${JSON.stringify(CLICK_TEXT)}, ${JSON.stringify(CLICK_SKIP)}, ${inBannerInPage})`).catch(() => ({ url: page.url(), footer: "", links: [], clickables: [] }));
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
// with only the navigation is stable long before the document itself arrives (NetBet's help pages). Text that does
// not satisfy it may be in the page but collapsed (SoftSwiss accordions): then the hidden text is read, and used when
// it is the document.
export async function readDoc(page, budget = 25000, want = (t) => t.length >= 500) {
  const t0 = Date.now();
  let lastLen = -1, seenLen = -1, wallSince = 0, hiddenAt = 0, lastHidden = -1;
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
    } else if (!DOC_WALL.test(head) && (settled || Date.now() - hiddenAt >= 3000)) {
      // The hidden text is read whether or not the visible text has settled: a page with a live element never settles.
      // Unsettled, it counts once two reads 3 s apart agree on its length (within 2%: a ticker is part of it).
      hiddenAt = Date.now();
      const h = await hidden(t);
      if (h && (settled || Math.abs(h.length - lastHidden) <= h.length * 0.02)) return { ok: true, text: h, hidden: true };
      lastHidden = h ? h.length : -1;
    }
    await sleep(1500);
  }
  const t = await bodyText(page);
  const wall = DOC_WALL.test(t.slice(0, 1500));
  if (!wall) { const h = await hidden(t); if (h) return { ok: true, text: h, hidden: true }; }
  return { ok: t.length >= 500 && !wall && !placeholder(t), text: t, note: wall ? "wall" : t.length < 500 ? "thin" : placeholder(t) ? "placeholder" : "still loading" };
}

/**
 * Clicks what looks like a collapsed section header; returns how many were clicked. Besides the marked-up kinds
 * (aria-expanded, <details>, accordion/collapse classes), a run of numbered section titles: five or more elements
 * reading "1. Introduction", "2. General Terms", ... (betfm.cc's utility-class accordion) or a bare "1", "2", ... next
 * to the title (the scored/greatspin/spinaro template), numbered 1, 2, 3 in page order.
 */
export async function expandSections(page) {
  return page.evaluate(() => {
    // Page chrome is skipped, but a "menu" or "header" container that holds half the page or more is the page's own
    // wrapper (scored's root div has a menu-* class), not chrome.
    const half = (document.body.innerText || "").length / 2, memo = new Map();
    const chrome = (el) => { const c = el.closest("nav, header, footer, [class*=menu i], [class*=cookie i]"); if (!c) return false; if (!memo.has(c)) memo.set(c, (c.innerText || "").length < half); return memo.get(c); };
    const ok = (el) => el.offsetParent !== null && (el.innerText || "").trim().length < 120 && !chrome(el);
    const marked = [...document.querySelectorAll('[aria-expanded="false"], details:not([open]) > summary, [class*="accordion" i] [class*="header" i], [class*="accordion" i] [class*="title" i], [class*="collaps" i] [class*="header" i], [class*="collaps" i] [class*="title" i]')].filter(ok);
    const numbered = [];
    for (const el of document.querySelectorAll("body *")) {
      if (el.children.length || !ok(el)) continue;
      const a = el.closest("a[href]");
      if (a && !/^(#|javascript:|)$/i.test((a.getAttribute("href") || "").trim())) continue;
      const m = /^(\d{1,2})\.?(\s+\S.*)?$/s.exec((el.innerText || "").trim());
      if (m && Number(m[1]) === numbered.length + 1) numbered.push(el);
    }
    const els = [...marked, ...(numbered.length >= 5 ? numbered.filter((el) => !marked.includes(el)) : [])];
    for (const el of els.slice(0, 80)) { try { el.click(); } catch { /* not clickable */ } }
    return els.length;
  }).catch(() => 0);
}

/**
 * Opens the casino's terms, in this order: anchors that score as the general terms (up to three); for apps whose
 * footer routes from plain elements, a click on the element that reads like the terms link; the sitemap and the
 * paths casinos commonly use; and last, anchors that scored as a promotion's terms, held to the same terms check.
 * Returns the page's text and URL, and what was tried.
 */
// Locale prefixes the casinos use for their non-English sites. The extraction patterns read English, so a terms
// page found under one of these is first tried at /en/ (then as found): spinit2.com/no/rules -> spinit2.com/en/rules.
const NON_ENGLISH = /^\/(no|nb|nn|sv|da|fi|de|fr|es|it|pt|pl|ru|tr|nl|ja|hu|cs|el|ro|bg|hr|sl|sk|lt|lv|et|uk|ar|zh|ko|th|vi|id|hi|ka|kk)(-[a-z]{2})?(?=\/|$)/i;
export function englishVariant(href) {
  try { const u = new URL(href); if (!NON_ENGLISH.test(u.pathname)) return ""; u.pathname = u.pathname.replace(NON_ENGLISH, "/en"); return u.href; } catch { return ""; }
}

// The paths casinos commonly use, most likely first. The guess phase tries the first twelve; each is also tried with
// the lobby's language prefix, the English prefix and bare, and those variants do not count against the twelve.
export const GUESS_PATHS = ["/terms-and-conditions", "/terms", "/terms-of-service", "/rules", "/user-agreement", "/terms-of-use", "/terms-conditions",
  "/general-terms-and-conditions", "/legal/terms-and-conditions", "/legal/terms", "/info/terms-and-conditions", "/help/terms-and-conditions",
  "/pages/terms-and-conditions", "/page/terms-and-conditions", "/tc"];
export function guessUrls(origin, lang = "") {
  const out = [];
  for (const p of GUESS_PATHS.slice(0, 12)) {
    if (NON_ENGLISH.test(lang)) out.push(`${origin}/en${p}`);
    out.push(`${origin}${lang}${p}`);
    if (lang) out.push(`${origin}${p}`);
  }
  return out;
}

// What the sitemap step reads, judged on the URL's path: the host is the casino's name, and dragonslots-1.com's own
// "slots" made every child sitemap look like a game sitemap.
const TERMS_URL = /terms|conditions|\btos\b|termos|\bagb\b|regulamin|user-?agreement|general-?rules/i, NOT_TERMS_URL = /privacy|cookie|bonus|promo|affiliate|sport|racing|poker|game|blog|news/i;
const urlPath = (u) => { try { return new URL(u).pathname; } catch { return u; } };
/** The first three child sitemaps of an index that are not game, product, blog, news or media sitemaps. */
export const sitemapChildren = (locs) => locs.filter((l) => !/product|game|slot|blog|news|image|video|post/i.test(urlPath(l))).slice(0, 3);
/** Up to four sitemap locations whose path names the general terms. */
export const sitemapTerms = (locs) => locs.filter((l) => TERMS_URL.test(urlPath(l)) && !NOT_TERMS_URL.test(urlPath(l))).slice(0, 4);

/** The guess phase's URLs in order: the sitemap's terms URLs, the sibling guesses, then the common paths. */
export const guessOrder = ({ sitemapLocs = [], links = [], pageUrl, origin, lang = "" }) =>
  [...sitemapTerms(sitemapLocs), ...siblingGuesses(links, pageUrl), ...guessUrls(origin, lang)];

export const dbg = (...a) => { if (process.env.DEBUG) console.error("[debug]", ...a); };
// `unblock` (optional) lifts the session's URL blocklist and resolves true: a page whose app needs a blocked file
// (wantedwin's terms come from a sqlite3 .wasm) renders an error instead of the document.
export async function fetchTerms(page, lobby, jev = { notes: [] }, { unblock } = {}) {
  const tried = [];
  // The lobby's own text, kept to tell it from a guessed path that only serves the lobby shell (the page is somewhere else by then).
  const lobbyText = (await bodyText(page).catch(() => "")) || "";
  // Is this the lobby again? An app routes an unknown path (a guessed one, an invented /en/ variant) to its shell.
  const lobbyRef = { len: lobbyText.length, fp: fingerprint(lobbyText) };
  // What the lobby hides (an SEO block, a collapsed footer): a guessed path that serves the lobby shell offers it as
  // hidden text, and it may read like terms.
  const lobbyHiddenText = (await page.evaluate(hiddenTextInPage).catch(() => "")) || "";
  const lobbyHidden = { len: lobbyHiddenText.length, fp: fingerprint(lobbyHiddenText) };
  const isLobby = (text) => !!lobbyText && (sameAsLobby(text, lobbyRef) || text.slice(0, 300) === lobbyText.slice(0, 300));
  let cands = termsCandidates(lobby.links, lobby.url);
  // Jev reads the footer once: its picks (when it is confident a terms link exists) go ahead of the scored anchors.
  // The page read validates every candidate, so a wrong pick costs one page load; no key or an error changes nothing.
  // "off" is noted once however many questions went unasked. After one failed call Jev is treated as down for the
  // rest of this casino: an outage would otherwise cost the call's timeout on every page judged.
  let jevDown = false;
  const note = (s) => { if (s !== "off" || !jev.notes.includes("off")) jev.notes.push(s); };
  const failed = (e) => { if (!jevDown) note(`error:${clip(e.message, 60)}`); jevDown = true; };
  const entries = linkEntries(lobby);
  let picks = [];
  let asked = false;
  if (entries.length) {
    try {
      const q = termsLinkQuestions(entries);
      const answers = await askJev(q.state, q.questions);
      picks = jevPicks(answers, entries);
      note(linkSummary(answers));
      asked = true;
    } catch (e) { failed(e); asked = true; }
  }
  if (!entries.length && !jevEnabled()) note("off"); // nothing to ask about, and no key either
  const jevLinks = picks.filter((p) => p.kind === "link" && !isMarketplaceUrl(p.href)).map((p) => ({ href: p.href, text: p.text, footer: p.in_footer, score: 99, jev: true }));
  cands = [...jevLinks, ...cands.filter((c) => !jevLinks.some((j) => j.href === c.href))];
  const jevTexts = picks.filter((p) => p.kind === "text").map((p) => p.text);
  lobby = { ...lobby, clickables: [...lobby.clickables.filter((c) => jevTexts.includes(c.text)), ...lobby.clickables.filter((c) => !jevTexts.includes(c.text))] };
  dbg("jev", asked ? jev.notes[jev.notes.length - 1] : "not asked", "picks:", picks.map((p) => `${p.p.toFixed(2)} ${p.kind} "${p.text}" ${p.href}`).join(" | "));
  // Pages Jev has judged in this search, by URL: a candidate is judged once.
  const judged = new Map();
  // `fast: false` skips the pattern's fast accept, so only Jev can accept the text (and without Jev it is rejected).
  const isTermsPage = async (text, meta, { fast = true } = {}) => {
    if (fast && readsLikeTerms(text)) return true; // the pattern is the fast accept; Jev reads what it rejects
    if (jevDown || text.length < 1500 || DOC_WALL.test(text.slice(0, 1500))) return false;
    // Keyed on the text's length too: an in-place click leaves the URL at the lobby's, and each opens a different document.
    const jk = `${meta.url}|${text.length}`;
    if (!judged.has(jk)) judged.set(jk, (async () => {
      try {
        const q = termsPageQuestion({ ...meta, text });
        const answers = await askJev(q.state, q.questions);
        note(pageSummary(answers));
        dbg("jev page", meta.url, pageSummary(answers));
        return acceptsPage(answers);
      } catch (e) { failed(e); return false; }
    })());
    return judged.get(jk);
  };
  const pageMeta = () => page.evaluate(() => ({ url: location.href, title: document.title, headings: [...document.querySelectorAll("h1, h2, h3")].map((h) => h.innerText.trim()).filter(Boolean) })).catch(() => ({ url: page.url(), title: "", headings: [] }));
  dbg(lobby.url, `${lobby.links.length} links, candidates:`, cands.slice(0, 6).map((c) => `${c.score} ${c.href} "${c.text.slice(0, 30)}"`).join(" | "), "clickables:", lobby.clickables.map((c) => `"${c.text}"${c.footer ? "(footer)" : ""}`).join(" | "));
  // A PDF is fetched as bytes and read in Node. page.request shares the session's cookies but not its proxy: it
  // leaves from this process (the VPN locally, the Actions runner on Browserless), which the file hosts allow.
  const tryPdf = async (c) => {
    try {
      const r = await page.request.get(c.href, { timeout: 30000 });
      if (!r.ok()) throw new Error(`http ${r.status()}`);
      const body = await r.body();
      if (body.length > 20 * 1048576) throw new Error("over 20 MB");
      const text = await pdfText(body);
      const good = text.length >= 500 && await isTermsPage(text, { url: c.href, title: "", headings: [] });
      dbg("pdf", c.href, good ? `ok ${text.length} chars` : `${text.length} chars, not terms-like`);
      if (good) return { href: c.href, text, via: "link", pdf: true, tried };
      tried.push(`${c.href} (${text.length < 500 ? "pdf thin" : "pdf not terms-like"})`);
    } catch (e) { tried.push(`${c.href} (pdf unreadable: ${clip(e.message, 50)})`); }
    return null;
  };
  // A thin terms page that only offers its document ("use the link below to view or download the Terms of Use"):
  // reached, not a wall, named like terms, and not itself the terms. Its own links to a document (a PDF, or "download",
  // "view") on the casino's domain or a file host are read, one hop only, at most twice per casino and never the same
  // document twice. `until` is the guess phase's deadline.
  let hopping = false, hopsLeft = 2;
  const hoppedDocs = new Set();
  const hopFrom = async (d, until = Infinity) => {
    if (hopping || hopsLeft <= 0 || d.note === "wall" || Date.now() > until) return null;
    const from = page.url(), meta = await pageMeta();
    if (!TERMS_TEXT.test([meta.title, ...meta.headings].join(" "))) return null;
    const links = await page.evaluate(() => [...document.querySelectorAll("a[href]")].map((a) => ({ href: a.href, text: (a.innerText || a.getAttribute("aria-label") || a.title || "").trim().slice(0, 80) }))).catch(() => []);
    const docs = docLinks(links, from).filter((l) => !hoppedDocs.has(l.href));
    dbg("hop", from, docs.map((l) => `${l.href} "${l.text}"`).join(" | ") || "no document link");
    if (!docs.length) return null;
    hopsLeft--;
    hopping = true;
    try { for (const doc of docs) { if (Date.now() > until) break; hoppedDocs.add(doc.href); const r = await tryLink(doc); if (r) return { ...r, via: from }; } } finally { hopping = false; }
    return null;
  };
  let pageWalled = false; // a wall on a candidate page itself; a wall on a document it links to says nothing about the site
  // A short page accepted as the terms may be collapsed, or a summary that links the document itself (beef.casino's /terms-use-site:
  // the opening paragraph and "MEHR LESEN" -> /de/terms-and-conditions). Under 5,000 characters, a link on it to an
  // own-domain page named as the general terms is read too, and the longer document is kept.
  // Before that, its collapsed sections are opened: jasino.com's terms passed on their section titles alone (2,246 chars).
  const fuller = async (r) => {
    if (hopping || r.pdf || r.text.length >= 5000) return r;
    if (await expandSections(page)) {
      const d = await readDoc(page, 10000, readsLikeTerms);
      dbg("fuller expanded", page.url(), r.text.length, "->", d.text.length, "chars");
      if (d.ok && readsLikeTerms(d.text) && d.text.length > r.text.length) r = { ...r, text: d.text, hidden: !!d.hidden };
      if (r.text.length >= 5000) return r;
    }
    const at = page.url(), bare = (u) => u.replace(/[?#].*$/, "").replace(/\/$/, "");
    const links = await page.evaluate(() => [...document.querySelectorAll("a[href]")].map((a) => ({ href: a.href, text: (a.innerText || "").trim().slice(0, 80), footer: !!a.closest("footer, [class*=footer i], #footer") }))).catch(() => []);
    // The best-scored such link, not the first in page order (a header's promotion link comes first).
    const full = termsCandidates(links.filter((l) => namedTermsPage(l.href, lobby.url) && bare(l.href) !== bare(at) && !visited.has(l.href)), lobby.url).find((l) => l.score > 0);
    dbg("fuller", at, r.text.length, "chars", full ? full.href : "no fuller page");
    if (!full) return r;
    hopping = true;
    try { const f = await tryLink({ href: full.href, text: full.text }); if (f && f.text.length > r.text.length) return { ...f, via: r.via }; } finally { hopping = false; }
    return r;
  };
  let unblocked = false;
  const visited = new Set(); // every URL tryLink opened, so a hub does not send the search back to one
  const tryLink = async (c) => {
    visited.add(c.href);
    if (isPdf(c.href)) return tryPdf(c);
    let resp;
    try { resp = await page.goto(c.href, { waitUntil: "domcontentloaded", timeout: 45000 }); } catch (e) {
      // A PDF served without a .pdf extension makes Chromium start a download instead of rendering.
      if (/Download is starting/i.test(e.message)) return tryPdf(c);
      tried.push(`${c.href} (${clip(e.message, 60)})`); return null;
    }
    if (/application\/pdf/i.test((resp && resp.headers()["content-type"]) || "")) return tryPdf({ ...c, href: page.url() });
    let d = await readDoc(page, c.english ? 15000 : 35000, readsLikeTerms); // BangaWin bounces through an auth callback for ~20 s before the text arrives
    // The /en/ variant is invented, not a link the casino gave: it counts only when it answered (no 4xx/5xx: wantedwin's
    // /en/terms-and-conditions is a 404 page), kept its /en segment and is not the lobby again.
    if (c.english && ((resp && resp.status() >= 400) || !/^\/en(-[a-z]{2})?(\/|$)/i.test(new URL(page.url()).pathname) || isLobby(d.text))) { tried.push(`${c.href} (english variant not found)`); return null; }
    if (d.note === "wall" && !hopping && !c.english) pageWalled = true; // the invented /en/ variant says nothing: the original URL decides
    // A terms page laid out as an accordion shows only its section titles (SoftSwiss "/rules" pages): open every
    // collapsed section and read again.
    if (!d.ok || !readsLikeTerms(d.text)) { if (await expandSections(page)) d = await readDoc(page, 10000, readsLikeTerms); }
    const good = d.ok && await isTermsPage(d.text, await pageMeta());
    dbg("link", c.href, good ? `ok ${d.text.length} chars` : d.ok ? "not terms-like" : d.note);
    if (good) return fuller({ href: page.url(), text: d.text, via: c.jev ? "jev" : "link", hidden: !!d.hidden, tried });
    tried.push(`${c.href} (${d.ok ? "not terms-like" : d.note})`);
    // A strong candidate (a Jev pick or a link that scores as the terms) that opened but did not read as the terms may
    // be broken by the blocklist: lift it for the rest of this casino and read the candidate once more.
    if (unblock && !unblocked && !c.english && !hopping && d.note !== "wall" && (c.jev || c.score >= 5)) {
      unblocked = true;
      // The retry's own hop and hub steps run on its fresh read: its result stands, so they are not spent twice.
      if (await unblock().catch(() => false)) { tried.push(`${c.href} again without the blocklist`); return tryLink(c); }
    }
    // An invented /en/ variant is not the casino's page: it is neither hopped from nor read as a hub.
    return (await hopFrom(d)) || (c.english ? null : hubFrom(d));
  };
  // Clicks a clickable on the page at `at` and reads what it opened: the app navigates, or opens the document in place.
  // On a lobby an in-place document has to add 2,000 characters; on a hub (`hub`), where a tab replaces one policy with
  // another, the text has to change (another start and a length 5% or more apart).
  const clickOpen = async (target, at, hub = false) => {
    const before = await bodyText(page);
    // What the page hides, to tell a document the click opened from the page's own text (megafrenzy.com).
    const lh = await page.evaluate(hiddenTextInPage).catch(() => "");
    const pageHidden = { len: lh.length, fp: fingerprint(lh) };
    const changed = (t) => hub ? fingerprint(t) !== fingerprint(before) && Math.abs(t.length - before.length) > before.length * 0.05 : t.length >= before.length + 2000;
    // A navigation is a new page: another path. A new query or hash on the same page (betportal's ?terms=38 opens a
    // promotion's terms over the lobby) is judged as opened in place.
    const moved = () => { try { const a = new URL(page.url()), b = new URL(at); return a.origin !== b.origin || a.pathname.replace(/\/$/, "") !== b.pathname.replace(/\/$/, ""); } catch { return page.url() !== at; } };
    // A script click: the element may sit under an overlay or outside the viewport, which a real click refuses.
    await page.evaluate((sel) => { const el = document.querySelector(sel); el.scrollIntoView({ block: "center" }); el.click(); }, target.sel);
    for (let i = 0; i < 8 && !moved() && !changed(await bodyText(page)); i++) await sleep(1500);
    let d = await readDoc(page, 15000, readsLikeTerms);
    const navigated = moved();
    if ((navigated || changed(d.text)) && !readsLikeTerms(d.text) && await expandSections(page)) d = await readDoc(page, 10000, readsLikeTerms);
    dbg("click", target.text, navigated ? page.url() : "no navigation", d.text.length, "chars");
    // No navigation and the hidden text is the page's own: nothing opened, whatever it says about terms.
    const unchanged = !navigated && d.hidden && sameAsLobby(d.text, pageHidden);
    // Opened in place, the document is what the click added: the page around it (a lobby's "T&Cs" captions) is not
    // judged with it (betportal's promotion modal passed as terms on the lobby's words).
    const doc = navigated || d.hidden ? d.text : addedText(d.text, before);
    // Opened in place, the pattern may accept it only under a general-terms heading with no promotion in sight
    // (fastInPlace); otherwise (betportal's "SPOOKY FRIDAY / 50 % FREDAGSBONUS" modal) only Jev may accept it.
    const fast = navigated || fastInPlace(doc);
    if (!unchanged && (navigated ? d.ok : changed(d.text)) && await isTermsPage(doc, await pageMeta(), { fast })) return { r: { href: page.url() !== at ? page.url() : `${at}#"${target.text}"`, text: doc, via: "click", hidden: !!d.hidden, tried } };
    tried.push(`click "${target.text}"${hub ? ` on ${at}` : ""} (${navigated ? (d.ok ? "not terms-like" : d.note) : !unchanged && changed(d.text) ? "opened, not terms-like" : "nothing opened"})`);
    return { navigated, d };
  };
  // A candidate page that is a hub of the casino's policies (tonplay.com's /policies/tonplay opens on its Dispute
  // Resolution Policy, and the Terms and Conditions are a tab with no href) is read like a lobby: its own terms link is
  // tried, else its terms tab is clicked. Once per casino, on the casino's own domain, never back to a page already tried.
  let hubLeft = 1;
  const hubFrom = async (d) => {
    if (hopping || hubLeft <= 0 || !d.ok || isLobby(d.text)) return null;
    const at = page.url(), bare = (u) => u.replace(/#.*$/, "");
    if (!withinDomain(host(at), registrable(host(lobby.url)))) return null;
    hopping = true;
    try {
      const sub = await readLobby(page, { quietMs: 3000, maxMs: 10000 });
      const link = termsCandidates(sub.links, lobby.url).find((x) => x.score > 0 && bare(x.href) !== bare(at) && !visited.has(x.href));
      let click = sub.clickables[0];
      dbg("hub", at, link ? link.href : "no link", click ? `"${click.text}"` : "no clickable");
      if (!link && !click) return null;
      hubLeft--;
      if (link) { const r = await tryLink(link); if (r) return { ...r, via: "hub" }; }
      if (click) {
        if (page.url() !== at) {
          await page.goto(at, { waitUntil: "domcontentloaded", timeout: 45000 }); await settle(page);
          click = (await readLobby(page, { quietMs: 3000, maxMs: 10000 })).clickables.find((x) => x.text === click.text);
          if (!click) return null;
        }
        const o = await clickOpen(click, at, true);
        if (o.r) return { ...o.r, via: "hub" };
      }
    } catch (e) { tried.push(`hub ${at} (${clip(e.message, 60)})`); } finally { hopping = false; }
    return null;
  };
  // An affiliate landing carries its tracking parameters into every link (go.netbet.co.uk); the page behind the
  // clean URL is the one a player reads, so it is tried first.
  const clean = (c) => ({ ...c, href: c.href.replace(/\?.*$/, "") });
  for (const c of cands.filter((c) => c.score > 0).slice(0, 3)) {
    const en = englishVariant(c.href);
    pageWalled = false;
    for (const v of [...(en ? [{ ...c, href: en, english: true }] : []), ...(c.href.includes("?") ? [clean(c), c] : [c])]) { const r = await tryLink(v); if (r) return r; }
    // The site walls its deeper pages from this exit (Flamez): nothing else on it will open either.
    if (pageWalled) return { href: "", text: "", via: "", tried, walled: true };
  }
  for (const c of lobby.clickables.slice(0, 2)) {
    try {
      if (page.url() !== lobby.url) { await page.goto(lobby.url, { waitUntil: "domcontentloaded", timeout: 45000 }); await settle(page); lobby = await readLobby(page); }
      const target = lobby.clickables.find((x) => x.text === c.text);
      if (!target) { tried.push(`click "${c.text}" (gone)`); continue; }
      const { r, navigated, d } = await clickOpen(target, lobby.url);
      if (r) return r;
      if (navigated) { const r = await hopFrom(d); if (r) return r; }
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
  // In order: the terms URLs the sitemap publishes; the terms' likely siblings, in the directory of the lobby's privacy,
  // cookie or responsible-gambling page (virginbet.co.za links only /dl/cookiepolicy; one group, not counted against
  // the twelve); then the twelve common paths.
  const guesses = [];
  const guessUntil = Date.now() + 180000; // the whole guessing phase, sitemap included, gets three minutes
  // The sitemap, following an index to its first few child sitemaps (skipping game, blog and media sitemaps).
  const sitemap = async (u) => {
    if (Date.now() > guessUntil) return { index: false, locs: [] };
    try {
      await page.goto(u, { waitUntil: "domcontentloaded", timeout: 20000 });
      const xml = await page.evaluate(() => document.documentElement.outerHTML).catch(() => "");
      return { index: /<sitemapindex/i.test(xml), locs: [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]) };
    } catch { return { index: false, locs: [] }; }
  };
  let sm = await sitemap(`${origin}/sitemap.xml`);
  if (!sm.locs.length) sm = await sitemap(`${origin}/sitemap_index.xml`);
  const pools = [];
  if (sm.index) { for (const child of sitemapChildren(sm.locs)) pools.push((await sitemap(child)).locs); }
  else pools.push(sm.locs);
  guesses.push(...guessOrder({ sitemapLocs: pools.flat(), links: lobby.links, pageUrl: lobby.url, origin, lang }));
  for (const href of [...new Set(guesses)]) {
    if (Date.now() > guessUntil) { tried.push("guessing stopped at the time budget"); break; }
    try { await page.goto(href, { waitUntil: "domcontentloaded", timeout: 15000 }); } catch { continue; }
    const d = await readDoc(page, 8000, readsLikeTerms);
    if (d.note === "wall") { tried.push(`${href} (wall)`); return { href: "", text: "", via: "", tried, walled: true }; }
    // Terms, not the lobby or a 404 shell: reads like terms, is not the lobby's text (or hidden text) again and passes
    // the terms check.
    const looksLikeTerms = d.ok && !isLobby(d.text) && !(d.hidden && sameAsLobby(d.text, lobbyHidden)) && (await isTermsPage(d.text, await pageMeta()));
    dbg("guess", href, d.ok ? `${d.text.length} chars${looksLikeTerms ? " TERMS" : ""}` : d.note);
    if (looksLikeTerms) return fuller({ href: page.url(), text: d.text, via: "guess", hidden: !!d.hidden, tried });
    const hopped = await hopFrom(d, guessUntil);
    if (hopped) return hopped;
  }
  tried.push(`${guesses.length} sitemap/guessed paths`);
  // Last, the links that scored as a promotion's terms: one may still be the general terms, so each goes through the
  // same terms check (a VIP level page is not the terms: starzbet.com).
  for (const c of cands.filter((c) => c.score <= 0).slice(0, 2)) { const r = await tryLink(c); if (r) return { ...r, via: "promo-terms" }; }
  if (!cands.length && !lobby.clickables.length) tried.unshift("no terms link or text on the lobby");
  return { href: "", text: "", via: "", tried };
}
