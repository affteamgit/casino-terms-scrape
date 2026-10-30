// Everything the scraper asks Jev (TypeSafe AI): the two judgments, their wording, how the answers are read, and
// the HTTP call. Jev supplies judgments; the code in terms.mjs decides what to do with them, and runs unchanged
// when there is no key or the call fails.
import { host, registrable, withinDomain, FILE_HOST } from "./links.mjs";

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
export const MAX_ENTRIES = 60;
const PAGE_TEXT_CHARS = 6000;

const key = () => process.env.TYPESAFE_API_KEY || "";
/** Whether there is a key: without one every question is skipped and the `jev` column reads `off`. */
export const jevEnabled = () => !!key();
const clip = (s, n) => (s || "").replace(/\s+/g, " ").trim().slice(0, n);
const path = (u) => { try { const x = new URL(u); return x.pathname + x.search; } catch { return u; } };
const slug = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24);
const LEGAL = /terms|conditions|\btos\b|legal|agreement|rules|policy|privacy|regulamin|\bagb\b|bedingungen|condi|termos/i;

/** One request. null without a key; the answers object otherwise; throws on failure after one retried 429. */
export async function askJev(state, questions, { timeoutMs = 20000, fetchFn = fetch } = {}) {
  if (!key()) return null;
  for (let i = 0; ; i++) {
    const res = await fetchFn(API, { method: "POST", headers: { authorization: `Bearer ${key()}`, "content-type": "application/json" }, body: JSON.stringify({ model: MODEL, state, questions }), signal: AbortSignal.timeout(timeoutMs) });
    if (res.status === 429 && i < 1) {
      const ra = res.headers.get("retry-after");
      await new Promise((r) => setTimeout(r, (ra === null || Number.isNaN(Number(ra)) ? 5 : Math.min(30, Number(ra))) * 1000));
      continue;
    }
    if (!res.ok) throw new Error(`jev http ${res.status}: ${clip(await res.text(), 200)}`);
    const body = await res.json();
    if (!body || typeof body.answers !== "object" || body.answers === null) throw new Error("jev: malformed response");
    return body.answers;
  }
}

/**
 * The lobby as Jev sees it: legal-looking footer links, then the clickable texts, then legal-looking links elsewhere,
 * then the rest of the footer; one entry per href; at most MAX_ENTRIES, so a footer of game links cannot push the
 * terms out. A link with no text and no legal-looking path (a payment logo, a licence seal) is left out. With fewer
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
  for (const c of clickables) add(c.text, "", c.footer, "text");
  for (const l of links) if (!l.footer && legal(l)) add(l.text, l.href, false, "link");
  for (const l of links) if (l.footer && !legal(l)) add(l.text, l.href, true, "link");
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

/** The page judgment: is this document the general terms. The opening of the page and its headings are enough. */
export function termsPageQuestion({ title, headings, text }) {
  return {
    state: { page: { title: clip(title, 120), headings: (headings || []).slice(0, 30).map((h) => clip(h, 80)), text: (text || "").slice(0, PAGE_TEXT_CHARS) } },
    questions: {
      is_terms: {
        type: "noul",
        instructions: "Is `page` the general terms and conditions of an online casino or sportsbook?",
        criteria: {
          true: "the general terms and conditions, terms of service, terms of use or user agreement that govern a player's account, deposits, bets and withdrawals, shown in full or as its opening sections",
          false: "a promotion's or bonus terms, a privacy or cookie policy, game or sports-betting rules, a help centre, a lobby, a registration form, or an error page",
        },
      },
    },
  };
}

export const acceptsPage = (answers) => !!answers && !!answers.is_terms && answers.is_terms.noul >= PAGE_NOUL_MIN;
export const pageSummary = (answers) => answers ? `page:${fmt(answers.is_terms?.noul)}` : "off";
