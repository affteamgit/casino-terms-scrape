// Chooses which of a lobby's links are the casino's terms, payments and KYC pages. Every anchor on the page is
// scored rather than taking the first match: promo cards carry "T&Cs apply" links to the home page or to the
// promotion's own terms, and those sit above the footer in the DOM.
const TERMS_PATH = /terms|conditions|\btos\b|\bt-?and-?c|\bt&c|\bagb\b|termos|condi[cç]|r[eè]gles|regulamin|pravila|kurallar|szabály|\blegal\b|general-?rules|user-?agreement|\brules\b/i;
export const TERMS_TEXT = /terms|conditions|t\s*&\s*c|\btos\b|user[-\s]agreement|termos|condi[cç][õo]es|condiciones|bedingungen|\bagb\b|r[eè]gles|regulamin|общие условия|правила|vilk[åa]r|villkor|betingelser|ehdot|käyttöehdot|regler og vilkår/i;
// A page whose own name is the general terms (the path's last segment) is a candidate whatever its caption says:
// horseshoeonlinecasino.com's footer links /support/terms-and-conditions as "Privacy Policy".
const STRONG_TERMS_PATH = /terms-?(and-?)?conditions|terms-of-(service|use)|user-agreement|general-terms/i;
// A product's own terms: the casino's general terms rank above them.
const PRODUCT = /\b(poker|sports?(book|betting)?|racing|horse|e-?sports?|lottery|bingo)\b/i;
const NOT_TERMS = /privacy|cookie|responsible|safer|affiliate|partner|(sport|racing|poker|game|betting)s?.?rules|rules-of|complaint|dispute|aml|kyc|know-?your/i;
const PROMO = /promo|offer|welcome|bonus|campaign|tournament|registration|free-?spin|jackpot|\brace\b|drops?\b|vip\b|loyalty|refer|lottery|cashback|reload|giveaway|competition|challenge|wheel|quest|mission/i;
const PAYMENTS = /payment|banking|withdraw|cashier|deposit[-\s]?(methods|options)|payout/i;
const KYC = /\bkyc\b|\baml\b|know[-\s]your|verification|anti[-\s]money/i;
// Hosts casinos park their legal PDFs on (betico.pro's terms live on CloudFront). Other domains are never the terms:
// a regulator's or a game provider's /terms must not win.
export const FILE_HOST = /(^|\.)(cloudfront\.net|amazonaws\.com|storage\.googleapis\.com|blob\.core\.windows\.net)$|^(cdn|static|files|assets|docs)\./i;
export const isPdf = (u) => /\.pdf(\?|#|$)/i.test(u);

export const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; } };
/** Is host `h` the domain `own` or a subdomain of it? (evilclubscasino.com is not clubscasino.com.) */
export const withinDomain = (h, own) => !!own && (h === own || h.endsWith("." + own));
export const registrable = (h) => { const l = h.split("."); return l.slice(l.length > 2 && /^(co|com|net|org|ac|gov|edu)$/.test(l[l.length - 2]) ? -3 : -2).join("."); };
const path = (u) => { try { const x = new URL(u); return x.pathname + x.hash; } catch { return ""; } };
const isHome = (u) => /^\/?(#.*)?$/.test(path(u)) || /^(index|home)\.\w+$/.test(path(u).replace(/^\//, ""));

/** Score for a link as the general terms page; null when it cannot be one. */
export function termsScore(l, pageUrl) {
  if (!/^https?:/i.test(l.href) || isHome(l.href)) return null;
  const text = (l.text || "").trim(), p = path(l.href), both = text + " " + p, name = p.split("/").filter(Boolean).pop() || "";
  // The path's own name says terms: the caption cannot reject it as privacy (horseshoe's "Privacy Policy" caption).
  const strong = STRONG_TERMS_PATH.test(name);
  const inPath = TERMS_PATH.test(p), inText = TERMS_TEXT.test(text);
  const own = host(l.href).endsWith(registrable(host(pageUrl)));
  if (!own && !(l.footer && inText && (isPdf(l.href) || FILE_HOST.test(host(l.href))))) return null;
  if (!inPath && !inText) return null;
  // Judged on the link text and the page's own name: 777's User Agreement lives under /security-and-privacy/.
  if (NOT_TERMS.test(strong ? name : text + " " + name)) return null;
  let s = (inPath ? 5 : 0) + (inText ? 3 : 0);
  if (strong) s += 1; // named as the general terms, ahead of a bare /legal or /rules page
  // A product's terms (/poker/terms, /sportsbook/terms) rank below the general terms. Read on the path's directories
  // only: a caption that names products ("Casino & Sports Terms") or a terms page's own name says nothing about them.
  if (p.split("/").filter(Boolean).slice(0, -1).some((g) => PRODUCT.test(g.replace(/[-_]/g, " ")))) s -= 3;
  if (PROMO.test(both)) s = Math.min(s - 6, 0); // a promotion's terms never rank as the general terms
  if (l.footer) s += 2;
  if (!own) s -= 3; // a PDF on a file host is the terms only when nothing on the casino's own domain is
  if (text.length > 40) s -= 2; // promo cards, not a footer link
  if (/#./.test(p)) s -= 2; // an anchor inside another page
  s -= Math.max(0, p.split("/").filter(Boolean).length - 2); // deep paths are usually a specific policy
  return s;
}

/** Terms candidates, best first, de-duplicated by URL. */
export function termsCandidates(links, pageUrl) {
  const seen = new Set();
  return links.map((l) => ({ ...l, score: termsScore(l, pageUrl) })).filter((l) => l.score !== null && !seen.has(l.href) && seen.add(l.href))
    .sort((a, b) => b.score - a.score);
}

/** One payments and one KYC link (the casino's own pages), skipping URLs already taken. */
export function otherDocs(links, pageUrl, taken = []) {
  const own = (l) => /^https?:/i.test(l.href) && host(l.href).endsWith(registrable(host(pageUrl))) && !isHome(l.href);
  const picked = [];
  for (const [kind, re] of [["payments", PAYMENTS], ["kyc", KYC]]) {
    const hit = links.find((l) => own(l) && (re.test(l.text) || re.test(path(l.href))) && !/privacy|cookie|responsible|bonus|affiliate/i.test(l.text + path(l.href)) && !taken.includes(l.href) && !picked.some((p) => p.href === l.href));
    if (hit) picked.push({ kind, href: hit.href });
  }
  return picked;
}

/**
 * A page that only asks the visitor to choose a country (unibet.com) links to the brand's regional sites. Returns
 * those links (same brand label, different registrable domain), the one matching the exit country first.
 */
export function regionalSites(links, pageUrl, country = "") {
  const here = registrable(host(pageUrl)), brand = here.split(".")[0];
  if (brand.length < 4) return [];
  const seen = new Set();
  const out = links.filter((l) => /^https?:/i.test(l.href)).map((l) => registrable(host(l.href)))
    .filter((d) => d !== here && d.split(".")[0] === brand && !seen.has(d) && seen.add(d));
  // The exit country's site first, then English-language markets (the quote patterns are English), then the rest.
  const rank = (d) => (country && d.endsWith("." + country) ? 0 : 1 + Math.max(0, ["co.uk", "ie", "com", "nz", "ca", "com.au", "eu"].findIndex((t) => d.endsWith("." + t)) + 1 || 99));
  return out.sort((a, b) => rank(a) - rank(b)).map((d) => `https://www.${d}/`);
}

/**
 * A thin terms page that only says "use the link below to view or download the Terms of Use" (clubscasino.com):
 * the links on it that lead to the document. A PDF, or a link whose text says download, view, open or read, or names
 * the terms (a bare verb needs a document-shaped target: .pdf/.doc or an uploads/files/docs/media path); on the
 * casino's own domain or a file host. PDFs and links that name the terms come first; at most two.
 */
export function docLinks(links, pageUrl) {
  const home = registrable(host(pageUrl)), seen = new Set();
  const rank = (l) => (isPdf(l.href) ? 2 : 0) + (TERMS_PATH.test(path(l.href)) || TERMS_TEXT.test(l.text || "") ? 3 : 0);
  return links.filter((l) => {
    if (!/^https?:/i.test(l.href) || isHome(l.href) || l.href === pageUrl || seen.has(l.href)) return false;
    const text = (l.text || "").trim(), name = path(l.href).split("/").filter(Boolean).pop() || "";
    // A verb alone ("Read more") is not enough: it has to lead to something shaped like a document.
    const verb = /\b(download|view|open|read)\b/i.test(text);
    if (!(isPdf(l.href) || TERMS_TEXT.test(text) || (verb && (/\.(pdf|docx?)(\?|#|$)/i.test(l.href) || /(^|\/)(uploads?|files|docs|documents|static|media)(\/|$)/i.test(path(l.href)))))) return false;
    if (!(withinDomain(host(l.href), home) || FILE_HOST.test(host(l.href)))) return false;
    if (NOT_TERMS.test(text + " " + name) || PROMO.test(text + " " + name)) return false;
    seen.add(l.href);
    return true;
  }).map((l, i) => ({ l, i, r: rank(l) })).sort((a, b) => b.r - a.r || a.i - b.i).map((x) => x.l).slice(0, 2);
}

/**
 * Terms pages usually sit next to the other legal pages. A lobby with no terms link but a privacy, cookie or
 * responsible-gambling link (virginbet.co.za: only "Cookie Policy" -> /dl/cookiepolicy) gets guesses in that link's
 * directory: /dl/terms, /dl/terms-and-conditions, ... Own-domain links with two or more path segments; a bare language
 * directory (/en/privacy) is left to the regular guesses. At most two directories, in page order.
 */
const LANG_DIR = /^\/(en|no|nb|nn|sv|da|fi|de|fr|es|it|pt|pl|ru|tr|nl|ja|hu|cs|el|ro|bg|hr|sl|sk|lt|lv|et|uk|ar|zh|ko|th|vi|id|hi|ka|kk)(-[a-z]{2})?$/i;
export const SIBLING_NAMES = ["terms", "terms-and-conditions", "termsandconditions", "terms-of-use", "terms-of-service", "general-terms"];
export function siblingGuesses(links, pageUrl) {
  const home = registrable(host(pageUrl)), dirs = [];
  for (const l of links) {
    let u;
    try { u = new URL(l.href); } catch { continue; }
    if (!/^https?:$/.test(u.protocol) || !withinDomain(host(l.href), home)) continue;
    const segs = u.pathname.split("/").filter(Boolean);
    if (segs.length < 2 || !/privacy|cookie|responsible|safer|gdpr|data-?protection/i.test(`${l.text || ""} ${segs[segs.length - 1]}`)) continue;
    const dir = `${u.origin}/${segs.slice(0, -1).join("/")}`;
    if (LANG_DIR.test(new URL(dir).pathname) || dirs.includes(dir)) continue;
    dirs.push(dir);
    if (dirs.length >= 2) break;
  }
  return dirs.flatMap((d) => SIBLING_NAMES.map((n) => `${d}/${n}`));
}

/**
 * Is `href` a page on the casino's domain whose own name (the path's last segment) is the general terms, with no
 * segment naming a promotion, a product, a VIP club or another policy (/promotions/terms-and-conditions,
 * /sportsbook/terms-and-conditions, /vip/terms-conditions are not)?
 */
export function namedTermsPage(href, pageUrl) {
  let u;
  try { u = new URL(href); } catch { return false; }
  const segs = u.pathname.split("/").filter(Boolean), name = segs[segs.length - 1] || "";
  return /^https?:$/.test(u.protocol) && withinDomain(host(href), registrable(host(pageUrl))) && STRONG_TERMS_PATH.test(name)
    && !segs.some(namesOther);
}
// A path segment that names a promotion, a product, a VIP club or another policy, read as whole words (split on - and
// _, each matched from its start): /promotions and /my_bonus do, /preferences ("refer") and /permission ("mission") do not.
const PROMO_WORD = new RegExp(`^(?:${PROMO.source})`, "i"), NOT_TERMS_WORD = new RegExp(`^(?:${NOT_TERMS.source})`, "i");
function namesOther(seg) {
  const words = seg.split(/[-_.]+/).filter(Boolean);
  return NOT_TERMS_WORD.test(seg) || PRODUCT.test(words.join(" ")) || /casino-?games/i.test(seg) || words.some((w) => PROMO_WORD.test(w) || NOT_TERMS_WORD.test(w));
}
