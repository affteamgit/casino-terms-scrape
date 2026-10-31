// Everything the scraper asks Jev (TypeSafe AI): the two judgments, their wording, how the answers are read, and
// the HTTP call. Jev supplies judgments; the code in terms.mjs decides what to do with them, and runs unchanged
// when there is no key or the call fails.
import { host, registrable, withinDomain, FILE_HOST, TERMS_TEXT, readsLikeTerms } from "./links.mjs";

const API = "https://api.typesafe.ai/v1/systemone";
export const MODEL = "jev-1.14.0"; // pinned: aliases move when a new release ships
export const LINK_NOUL_MIN = 0.7; // "the lobby has a terms link" must be at least this likely before a pick is used
export const LINK_PICK_MIN = 0.2; // an option is tried when at least this likely (at most two)
// A near-certain pick is tried even when "a terms link exists" is only middling (horseshoe: has_terms 0.48, pick 0.98 on
// a /support/terms-and-conditions link captioned "Privacy Policy"). Picks are candidates, the page read is the gate,
// so this costs at most one page load.
export const LINK_NOUL_SURE_MIN = 0.4;
export const LINK_PICK_SURE = 0.9;
export const PAGE_NOUL_MIN = 0.7; // "this page is the general terms"
// Real general terms came back 0.65-0.69 when the text began with the lobby's menu (rushgames, wonderlandcasino), bonus
// and product terms 0.02-0.43: from PAGE_NOUL_BORDER up to PAGE_NOUL_MIN a page is asked the exclusion question too,
// and accepted when Jev rules the exclusions out (not_general at most EXCLUSION_MAX) and the page reads like terms.
export const PAGE_NOUL_BORDER = 0.5;
export const EXCLUSION_MAX = 0.3;
export const MAX_ENTRIES = 60;
const PAGE_TEXT_CHARS = 6000;

const key = () => process.env.TYPESAFE_API_KEY || "";
/** Whether there is a key: without one every question is skipped and the `jev` column reads `off`. */
export const jevEnabled = () => !!key();
const clip = (s, n) => (s || "").replace(/\s+/g, " ").trim().slice(0, n);
const path = (u) => { try { const x = new URL(u); return x.pathname + x.search; } catch { return u; } };
const slug = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24);
// A non-footer link is shown to Jev only when it reads legal: those words, or the terms words of any language.
const LEGAL = new RegExp(`terms|conditions|\\btos\\b|legal|agreement|rules|policy|privacy|regulamin|\\bagb\\b|bedingungen|condi|termos|${TERMS_TEXT.source}`, "i");

const RETRY_DELAYS = [2000, 5000, 10000]; // waits before attempts 2, 3 and 4
const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Overloaded or failing on Jev's side (the 48-minute 529 outage of the full run): worth another try. Any other 4xx is not. */
const retryable = (status) => status === 429 || status >= 500;

/**
 * One request. null without a key; the answers object otherwise. A 429, a 5xx (529 overloaded included) or a network
 * failure is tried again after 2 s, 5 s and 10 s (four attempts); the last failure is thrown as it came, so the `jev`
 * column's `error:jev http 529: ...` note stays what `retry-ids` looks for. Any other 4xx and a malformed answer throw at once.
 * `fetch` and `sleep` are for the tests.
 */
export async function askJev(state, questions, { timeoutMs = 20000, fetch: f = globalThis.fetch, sleep: s = defaultSleep } = {}) {
  if (!key()) return null;
  for (let i = 0; ; i++) {
    if (i > 0) await s(RETRY_DELAYS[i - 1]);
    let res;
    try {
      res = await f(API, { method: "POST", headers: { authorization: `Bearer ${key()}`, "content-type": "application/json" }, body: JSON.stringify({ model: MODEL, state, questions }), signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      if (i < RETRY_DELAYS.length) continue;
      throw err;
    }
    if (!res.ok) {
      const err = new Error(`jev http ${res.status}: ${clip(await res.text(), 200)}`);
      if (retryable(res.status) && i < RETRY_DELAYS.length) continue;
      throw err;
    }
    const body = await res.json();
    if (!body || typeof body.answers !== "object" || body.answers === null) throw new Error("jev: malformed response");
    return body.answers;
  }
}

/**
 * The lobby as Jev sees it: legal-looking footer links in footer order, legal-looking links elsewhere, the clickable
 * texts, then the rest of the footer with any caption (any language or script: a caption the word lists do not know
 * must still reach Jev), last link first; one entry per href; at most MAX_ENTRIES, so a footer of game links cannot
 * push the terms out. A link with no text and no legal-looking path (a payment logo, a licence seal) is left out. With fewer
 * than five entries the page's last anchors are added (see below). Option names
 * are sent to the model, so each id starts with the link's own words.
 */
export function linkEntries(lobby) {
  const seen = new Set(), out = [];
  const links = lobby?.links || [], clickables = lobby?.clickables || [];
  const legal = (l) => LEGAL.test(`${l.text || ""} ${path(l.href)}`);
  const add = (rawText, href, footer, kind) => {
    const text = clip(rawText, 60);
    const k = href || `text:${text}`;
    if (seen.has(k) || out.length >= MAX_ENTRIES) return;
    if (!text && !(href && LEGAL.test(path(href)))) return;
    seen.add(k);
    out.push({ id: `${slug(text) || slug(path(href)) || "link"}_${out.length}`, text, href: href || "", in_footer: !!footer, kind });
  };
  for (const l of links) if (l.footer && legal(l)) add(l.text, l.href, true, "link");
  for (const l of links) if (!l.footer && legal(l)) add(l.text, l.href, false, "link");
  for (const c of clickables) add(c.text, "", c.footer, "text");
  // The rest of the footer, whatever the caption (a terms link in a language the word lists do not know), from the end:
  // the legal row is usually last, below the game links.
  for (const l of [...links].reverse()) if (l.footer && !legal(l)) add(l.text, l.href, true, "link");
  // No footer was found and nothing reads as legal (koalabet, jasino, betportal): Jev still sees the bottom of the
  // page, the last anchors in DOM order (bottom first), on the casino's domain or a file host.
  if (out.length < 5) {
    const own = registrable(host(lobby?.url || ""));
    const near = (l) => { const h = host(l.href); return !!h && (withinDomain(h, own) || FILE_HOST.test(h)); };
    for (const l of [...links].reverse()) if (out.length < MAX_ENTRIES && near(l)) add(l.text, l.href, false, "link");
  }
  return out;
}

/** The footer judgment: is there a general-terms link, and which entry is it. Returns null when there are no entries (a Choice needs options), so callers skip the call. */
export function termsLinkQuestions(entries) {
  if (!entries || !entries.length) return null;
  const describe = (e) => `${e.kind === "text" ? "clickable text" : "link"} "${e.text}"${e.href ? ` to ${clip(path(e.href), 100)}` : ""}${e.in_footer ? ", in the footer" : ""}`;
  return {
    state: { links: entries.map(({ id, text, href, in_footer }) => ({ id, text, href: clip(href, 160), in_footer })) },
    questions: {
      has_terms: {
        type: "noul",
        instructions: "Does `links` contain a link to the casino's own general terms and conditions?",
        criteria: {
          true: "an entry whose text or URL means the general terms and conditions, terms of service, terms of use or user agreement of the casino itself",
          false: "only privacy, cookie, responsible-gambling, bonus or promotion terms, sports or game rules, 'T&Cs apply' captions, or no legal links at all",
        },
      },
      terms_link: {
        type: "choice",
        instructions: "Which entry in `links` is the link to the casino's own general terms and conditions?",
        criteria: Object.fromEntries(entries.map((e) => [e.id, describe(e)])),
      },
    },
  };
}

/** Jev's picks worth trying, best first: none unless Jev also thinks a terms link exists, or is near certain of one option. */
export function jevPicks(answers, entries) {
  const noul = answers?.has_terms?.noul;
  if (!answers || !answers.terms_link || !(noul >= LINK_NOUL_SURE_MIN)) return [];
  // Confident a terms link exists: up to two options. Middling: only one option Jev is near certain of.
  const [min, max] = noul >= LINK_NOUL_MIN ? [LINK_PICK_MIN, 2] : [LINK_PICK_SURE, 1];
  return Object.entries(answers.terms_link.probabilities || {}).filter(([, p]) => p >= min).sort((a, b) => b[1] - a[1])
    .map(([id, p]) => ({ entry: entries.find((e) => e.id === id), p })).filter((x) => x.entry).slice(0, max)
    .map(({ entry, p }) => ({ ...entry, p }));
}

const fmt = (n) => (typeof n === "number" && Number.isFinite(n) ? n.toFixed(2) : "?");
export const linkSummary = (answers) => {
  if (!answers) return "off";
  const probs = answers.terms_link?.probabilities;
  return `link:${fmt(answers.has_terms?.noul)}/${probs && typeof probs === "object" ? fmt(Math.max(0, ...Object.values(probs))) : "?"}`;
};

// The page as Jev sees it. `core`: the text is what the page adds beyond the lobby's header and footer (coreText), not
// the page's whole text.
const pageState = ({ url, title, headings, text, core }) => ({ page: { url: clip(url, 200), title: clip(title, 120), headings: (headings || []).slice(0, 30).map((h) => clip(h, 80)), text: (text || "").slice(0, PAGE_TEXT_CHARS), core: !!core } });

/**
 * The page judgment: is this document the general terms of the whole site. The URL (so Jev sees the path), the opening
 * of the page and its headings are enough. A product section's terms (elarabet's sportsbook terms read like general
 * terms) are not.
 */
export function termsPageQuestion(meta) {
  return {
    state: pageState(meta),
    questions: {
      is_terms: {
        type: "noul",
        instructions: "Is `page` the general terms and conditions that govern the whole site (an online casino, sportsbook or both)?",
        criteria: {
          true: "the general terms and conditions, terms of service, terms of use or user agreement that govern a player's account, deposits, bets and withdrawals, shown in full or as its opening sections",
          false: "the terms of one product section (sportsbook, poker, bingo, racing, live casino) of a site that also offers other products, a promotion's or bonus terms, a privacy or cookie policy, game or sports-betting rules, a help centre, a lobby, a registration form, or an error page",
        },
      },
    },
  };
}

/**
 * The exclusion judgment, asked about a borderline page (is_terms from PAGE_NOUL_BORDER up to PAGE_NOUL_MIN) with the
 * same state: is it anything other than the general terms of the whole site.
 */
export function exclusionQuestion(meta) {
  return {
    state: pageState(meta),
    questions: {
      not_general: {
        type: "noul",
        instructions: "Is `page` a promotion's or bonus terms, one product section's terms (sportsbook, poker, bingo, racing, live casino), a privacy or cookie policy, game or betting rules, a help article, or anything other than the general terms and conditions of the whole site?",
        criteria: {
          true: "a promotion's or bonus terms, the terms of one product section (sportsbook, poker, bingo, racing, live casino) of a site that also offers other products, a privacy or cookie policy, game or sports-betting rules, a help article, a lobby, a registration form, an error page, or any other page",
          false: "the general terms and conditions, terms of service, terms of use or user agreement that govern a player's account, deposits, bets and withdrawals on the whole site, shown in full or as its opening sections",
        },
      },
    },
  };
}

export const acceptsPage = (answers) => !!answers && !!answers.is_terms && answers.is_terms.noul >= PAGE_NOUL_MIN;
/** A borderline page: Jev leans to the general terms, rules the exclusions out, and the text reads like terms. */
export const acceptsBorderline = (answers, exclusion, text) => !!answers?.is_terms && answers.is_terms.noul >= PAGE_NOUL_BORDER
  && !!exclusion?.not_general && exclusion.not_general.noul <= EXCLUSION_MAX && readsLikeTerms(text || "");
/** The `jev` column's note for a page: `page:<noul>`, and ` excl:<noul>` when the exclusion question was asked. */
export const pageSummary = (answers, exclusion) => answers ? `page:${fmt(answers.is_terms?.noul)}${exclusion ? ` excl:${fmt(exclusion.not_general?.noul)}` : ""}` : "off";

export const LOBBY_P_MIN = 0.8; // the top lobby option must be this likely ...
export const LOBBY_CONFIDENCE_MIN = 0.7; // ... and the answer's confidence this high, before a lobby is given a status
// option -> the status it gives; `gambling_site` gives none
const LOBBY_STATUS = { geo_or_regulatory_notice: "geo_blocked", closed_or_suspended: "closed", parked_or_for_sale: "parked", not_gambling_site: "not_casino", error_or_bot_wall: "blocked_http" };

/**
 * The lobby judgment, asked when the lobby offers no terms link or clickable: what is this page. `captions` are the
 * footer's link texts and the clickable texts. Affiliate and review sites, blogs and templates answer here what no
 * pattern could say.
 */
export function lobbyQuestion({ url, title, text, captions }) {
  return {
    state: { page: { url: clip(url, 200), title: clip(title, 120), text: (text || "").slice(0, 3000), captions: (captions || []).slice(0, MAX_ENTRIES).map((c) => clip(c, 60)) } },
    questions: {
      kind: {
        type: "choice",
        instructions: "What is `page`? Judge from the page's text and link captions, not from the domain name: a domain that once hosted a casino may now hold unrelated content.",
        criteria: {
          gambling_site: "an online casino, sportsbook, poker, bingo or lottery operator's own site, whatever its language",
          geo_or_regulatory_notice: "a notice that the service is not offered in the visitor's country or region, or is blocked by a regulator",
          closed_or_suspended: "a notice that the site has closed, ceased operating or been suspended",
          parked_or_for_sale: "a parked domain or a domain for sale",
          not_gambling_site: "an affiliate, review, comparison or news site, a blog, a template or placeholder page, or a software vendor's page, not an operator's own site",
          error_or_bot_wall: "an error page, an access-denied page or a bot or human-verification wall",
        },
      },
    },
  };
}

/** The status a confident lobby answer gives: "geo_blocked", "closed", "parked", "not_casino", "blocked_http"; null for a gambling site, an unsure answer or none. */
export function lobbyVerdict(answers) {
  const a = answers?.kind;
  if (!a || !((a.confidence ?? a.noul) >= LOBBY_CONFIDENCE_MIN) || !a.probabilities || typeof a.probabilities !== "object") return null;
  const [top, p] = Object.entries(a.probabilities).sort((x, y) => y[1] - x[1])[0] || [];
  return p >= LOBBY_P_MIN && Object.hasOwn(LOBBY_STATUS, top) ? LOBBY_STATUS[top] : null;
}

/** The `jev` column's note for a lobby answer: `lobby:<option>:<p>`. */
export const lobbySummary = (answers) => {
  const probs = answers?.kind?.probabilities;
  if (!answers || !probs || typeof probs !== "object") return "off";
  const [top, p] = Object.entries(probs).sort((x, y) => y[1] - x[1])[0] || [];
  return top ? `lobby:${top}:${fmt(p)}` : "off";
};
