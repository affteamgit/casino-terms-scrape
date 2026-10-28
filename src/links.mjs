// Chooses which of a lobby's links are the casino's terms, payments and KYC pages. Every anchor on the page is
// scored rather than taking the first match: promo cards carry "T&Cs apply" links to the home page or to the
// promotion's own terms, and those sit above the footer in the DOM.
const TERMS_PATH = /terms|conditions|\btos\b|\bt-?and-?c|\bt&c|\bagb\b|termos|condi[cç]|r[eè]gles|regulamin|pravila|kurallar|szabály|\blegal\b|general-?rules|user-?agreement/i;
const TERMS_TEXT = /terms|conditions|t\s*&\s*c|\btos\b|user[-\s]agreement|termos|condi[cç][õo]es|condiciones|bedingungen|\bagb\b|r[eè]gles|regulamin|общие условия|правила/i;
const NOT_TERMS = /privacy|cookie|responsible|safer|affiliate|partner|sport.?rules|racing.?rules|poker.?rules|game.?rules|betting.?rules|rules-of|complaint|dispute|aml|kyc|know-?your/i;
const PROMO = /promo|offer|welcome|bonus|campaign|tournament|registration|free-?spin|jackpot|\brace\b|drops?\b|vip\b|loyalty|refer|lottery|cashback|reload|giveaway|competition|challenge|wheel|quest|mission/i;
const PAYMENTS = /payment|banking|withdraw|cashier|deposit[-\s]?(methods|options)|payout/i;
const KYC = /\bkyc\b|\baml\b|know[-\s]your|verification|anti[-\s]money/i;

export const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; } };
export const registrable = (h) => { const l = h.split("."); return l.slice(l.length > 2 && /^(co|com|net|org|ac|gov|edu)$/.test(l[l.length - 2]) ? -3 : -2).join("."); };
const path = (u) => { try { const x = new URL(u); return x.pathname + x.hash; } catch { return ""; } };
const isHome = (u) => /^\/?(#.*)?$/.test(path(u)) || /^(index|home)\.\w+$/.test(path(u).replace(/^\//, ""));

/** Score for a link as the general terms page; null when it cannot be one. */
export function termsScore(l, pageUrl) {
  if (!/^https?:/i.test(l.href) || isHome(l.href)) return null;
  if (!host(l.href).endsWith(registrable(host(pageUrl)))) return null;
  const text = (l.text || "").trim(), p = path(l.href), both = text + " " + p;
  const inPath = TERMS_PATH.test(p), inText = TERMS_TEXT.test(text);
  if (!inPath && !inText) return null;
  // Judged on the link text and the page's own name: 777's User Agreement lives under /security-and-privacy/.
  if (NOT_TERMS.test(text + " " + (p.split("/").filter(Boolean).pop() || ""))) return null;
  let s = (inPath ? 5 : 0) + (inText ? 3 : 0);
  if (PROMO.test(both)) s = Math.min(s - 6, 0); // a promotion's terms never rank as the general terms
  if (l.footer) s += 2;
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
