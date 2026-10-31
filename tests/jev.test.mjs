import { test } from "node:test";
import assert from "node:assert/strict";
import { askJev, linkEntries, termsLinkQuestions, jevPicks, linkSummary, termsPageQuestion, acceptsPage, pageSummary, jevEnabled, MAX_ENTRIES, lobbyQuestion, lobbyVerdict, lobbySummary } from "../src/jev.mjs";

const L = (text, href, footer = false) => ({ text, href, footer });
const betico = {
  url: "https://betico.pro/",
  links: [L("Slots", "https://betico.pro/casino/slots"), L("Sports Betting Rules", "https://d2xmnpb6h303sl.cloudfront.net/static/terms/sports-betting.pdf", true),
    L("Terms of Service", "https://d2xmnpb6h303sl.cloudfront.net/static/navigation/terms_and_conditions.pdf", true), L("Privacy", "https://betico.pro/privacy", true),
    L("", "https://verification.anjouangamingboard.org/validate?x=1", true), L("Promotions", "https://betico.pro/promotion", true), L("Terms of Service", "https://d2xmnpb6h303sl.cloudfront.net/static/navigation/terms_and_conditions.pdf", true)],
  clickables: [{ text: "T&Cs apply", footer: false }, { text: "Conditions:", footer: true }],
};

test("linkEntries: footer links first, de-duplicated, descriptive ids, clickables as text entries, logo links without text dropped", () => {
  const e = linkEntries(betico);
  // legal-looking footer links, then the clickable texts, then the rest of the footer
  assert.deepEqual(e.map((x) => x.text), ["Sports Betting Rules", "Terms of Service", "Privacy", "T&Cs apply", "Conditions:", "Promotions"]);
  assert.match(e[1].id, /^terms_of_service_\d+$/);
  assert.equal(e[1].href, "https://d2xmnpb6h303sl.cloudfront.net/static/navigation/terms_and_conditions.pdf");
  assert.equal(e[1].in_footer, true);
  assert.deepEqual(e.slice(3, 5).map((x) => x.kind), ["text", "text"]);
  assert.equal(new Set(e.map((x) => x.id)).size, e.length);
});

test("linkEntries: a non-footer link joins only when it looks legal", () => {
  const links = [...Array.from({ length: 5 }, (_, i) => L(`Link ${i}`, `https://x.com/f/${i}`, true)), L("User Agreement", "https://x.com/legal/user-agreement"), L("Blackjack", "https://x.com/blackjack"), L("Pravila igre", "https://x.com/p/9")];
  const e = linkEntries({ url: "https://x.com/", links, clickables: [] });
  assert.deepEqual(e.slice(0, 2).map((x) => x.text), ["User Agreement", "Pravila igre"]);
  assert.ok(!e.some((x) => x.text === "Blackjack"));
});

test("linkEntries: no footer found, so Jev sees the bottom of the page (koalabet, jasino, betportal)", () => {
  const links = [L("Home", "https://k.io/"), ...Array.from({ length: 70 }, (_, i) => L(`Game ${i}`, `https://k.io/g/${i}`)),
    L("Partner", "https://partner.example.com/x"), L("Docs", "https://docs.k.io/about.html"), L("Help", "https://cdn.files.example/help.pdf"), L("Game 69", "https://k.io/g/69")];
  const e = linkEntries({ url: "https://k.io/en", links, clickables: [] });
  assert.equal(e.length, MAX_ENTRIES);
  assert.deepEqual(e.slice(0, 3).map((x) => x.text), ["Game 69", "Help", "Docs"], "bottom of the page first, one entry per href, a file host kept");
  assert.ok(!e.some((x) => x.text === "Partner"), "another domain is left out");
  assert.ok(e.every((x) => x.in_footer === false && x.kind === "link"));
  assert.ok(!e.some((x) => x.href === "https://k.io/g/0"), "only the last anchors");
  // a lobby whose footer gave five or more entries is not padded
  const footer = Array.from({ length: 5 }, (_, i) => L(`Link ${i}`, `https://k.io/f/${i}`, true));
  assert.equal(linkEntries({ url: "https://k.io/", links: [...links, ...footer], clickables: [] }).length, 5);
  // a few legal entries are padded, and kept ahead of the padding
  const few = linkEntries({ url: "https://k.io/", links: [L("Privacy", "https://k.io/privacy"), ...links.slice(0, 10)], clickables: [{ text: "Terms of Service", footer: false }] });
  assert.deepEqual(few.slice(0, 2).map((x) => x.text), ["Privacy", "Terms of Service"]);
  assert.equal(few.length, 12);
});

test("linkEntries: every footer link with a caption is shown, whatever its language or script; legal ones first, the rest from the end of the footer", () => {
  const links = [L("Slots", "https://x.com/casino/slots"), L("Uslovi korišćenja", "https://x.com/uslovi-koriscenja", true), L("Genel Şartlar ve Kurallar", "https://x.com/sartlar", true),
    L("الشروط والأحكام", "https://x.com/ar/terms", true), L("ข้อกำหนดและเงื่อนไข", "https://x.com/th/tnc", true), L("Blackjack", "https://x.com/games/blackjack", true),
    L("Roulette", "https://x.com/games/roulette", true), L("Legal", "https://x.com/about/l"), L("", "https://x.com/seal.png", true)];
  const e = linkEntries({ url: "https://x.com/", links, clickables: [{ text: "Vilkår", footer: false }] });
  assert.deepEqual(e.map((x) => x.text), ["Uslovi korišćenja", "Genel Şartlar ve Kurallar", "الشروط والأحكام", "ข้อกำหนดและเงื่อนไข", "Legal", "Vilkår", "Roulette", "Blackjack"]);
  assert.ok(e.slice(0, 4).every((x) => x.in_footer && x.kind === "link"));
  assert.ok(!e.some((x) => x.text === "Slots"), "a non-footer link that does not look legal stays out");
  assert.equal(new Set(e.map((x) => x.id)).size, e.length);
});

test("linkEntries: a big footer of game links cannot push the legal links out, and the cap is exact", () => {
  const links = [...Array.from({ length: 70 }, (_, i) => L(`Game ${i}`, `https://x.com/g/${i}`, true)), L("Uslovi korišćenja", "https://x.com/p/12", true), L("Terms", "https://x.com/t")];
  const e = linkEntries({ url: "https://x.com/", links, clickables: [] });
  assert.equal(e.length, MAX_ENTRIES);
  assert.deepEqual(e.slice(0, 2).map((x) => x.text), ["Uslovi korišćenja", "Terms"]);
  assert.equal(e[2].text, "Game 69", "the rest of the footer from its end");
  // a foreign-language terms link at the end of a long footer whose caption the word lists do not know
  const odd = linkEntries({ url: "https://x.com/", links: [...links.slice(0, 70), L("Zasady", "https://x.com/p/13", true)], clickables: [] });
  assert.equal(odd.length, MAX_ENTRIES);
  assert.equal(odd[0].text, "Zasady");
});

test("linkEntries: 'Sport & Casino' is not legal, 'T&Cs' is", () => {
  const links = [...Array.from({ length: 5 }, (_, i) => L(`Link ${i}`, `https://x.com/f/${i}`, true)), L("Sport & Casino", "https://x.com/sc"), L("T&Cs", "https://x.com/tc")];
  const e = linkEntries({ url: "https://x.com/", links, clickables: [] });
  assert.equal(e[0].text, "T&Cs");
  assert.ok(!e.some((x) => x.text === "Sport & Casino"));
});

test("linkEntries: a captionless footer link with a legal path is kept, one without is not", () => {
  const few = linkEntries({ url: "https://x.com/", links: [L("", "https://x.com/terms", true), L("", "https://x.com/logo", true)], clickables: [] });
  assert.deepEqual(few.map((x) => x.href), ["https://x.com/terms"]);
});

test("termsLinkQuestions: the Choice's options are the entry ids and the state carries no kind", () => {
  const e = linkEntries(betico);
  const q = termsLinkQuestions(e);
  assert.deepEqual(Object.keys(q.questions.terms_link.criteria), e.map((x) => x.id));
  assert.equal(q.questions.has_terms.type, "noul");
  assert.deepEqual(Object.keys(q.state.links[0]), ["id", "text", "href", "in_footer"]);
  assert.match(q.questions.terms_link.criteria[e[1].id], /Terms of Service.*terms_and_conditions\.pdf.*footer/);
});

test("jevPicks: confident answers give up to two picks, best first; a low Noul or no answer gives none", () => {
  const e = linkEntries(betico);
  const [rules, terms, privacy] = e;
  const probs = { [rules.id]: 0.25, [terms.id]: 0.7, [privacy.id]: 0.05 };
  const picks = jevPicks({ has_terms: { noul: 0.9 }, terms_link: { choice: terms.id, confidence: 0.6, probabilities: probs } }, e);
  assert.deepEqual(picks.map((p) => p.text), ["Terms of Service", "Sports Betting Rules"]);
  assert.equal(picks[0].p, 0.7);
  assert.deepEqual(jevPicks({ has_terms: { noul: 0.4 }, terms_link: { probabilities: probs } }, e), []);
  // a missing or non-numeric Noul never passes the gate
  assert.deepEqual(jevPicks({ has_terms: {}, terms_link: { probabilities: probs } }, e), []);
  assert.deepEqual(jevPicks({ terms_link: { probabilities: probs } }, e), []);
  assert.deepEqual(jevPicks({ has_terms: { noul: NaN }, terms_link: { probabilities: probs } }, e), []);
  // boundaries are inclusive: Noul 0.7 and probability 0.2 pass
  assert.equal(jevPicks({ has_terms: { noul: 0.7 }, terms_link: { probabilities: probs } }, e).length, 2);
  assert.equal(jevPicks({ has_terms: { noul: 0.69 }, terms_link: { probabilities: probs } }, e).length, 0);
  assert.deepEqual(jevPicks({ has_terms: { noul: 0.9 }, terms_link: { probabilities: { [rules.id]: 0.2 } } }, e).map((p) => p.text), ["Sports Betting Rules"]);
  assert.deepEqual(jevPicks({ has_terms: { noul: 0.9 }, terms_link: { probabilities: { [rules.id]: 0.19 } } }, e), []);
  // at most two picks, even with three options at or above the minimum
  const three = jevPicks({ has_terms: { noul: 0.9 }, terms_link: { probabilities: { [rules.id]: 0.3, [terms.id]: 0.4, [privacy.id]: 0.25 } } }, e);
  assert.deepEqual(three.map((p) => p.text), ["Terms of Service", "Sports Betting Rules"]);
  // an id that is not an entry does not displace a valid pick
  assert.deepEqual(jevPicks({ has_terms: { noul: 0.9 }, terms_link: { probabilities: { ghost: 0.9, ghost2: 0.8, [terms.id]: 0.5, [rules.id]: 0.4 } } }, e).map((p) => p.text), ["Terms of Service", "Sports Betting Rules"]);
  assert.deepEqual(jevPicks(null, e), []);
  assert.deepEqual(jevPicks({ has_terms: { noul: 0.9 }, terms_link: { probabilities: { nope: 1 } } }, e), []);
});

test("jevPicks: a near-certain pick passes with a middling has_terms (horseshoe 0.48/0.98), at most one such pick", () => {
  const e = linkEntries(betico);
  const [rules, terms] = e;
  const near = (noul, p, extra = {}) => jevPicks({ has_terms: { noul }, terms_link: { probabilities: { [terms.id]: p, ...extra } } }, e);
  assert.deepEqual(near(0.48, 0.98).map((x) => x.text), ["Terms of Service"]);
  assert.deepEqual(near(0.48, 0.85), [], "not near-certain");
  assert.deepEqual(near(0.39, 0.99), [], "has_terms under 0.4");
  assert.deepEqual(near(0.4, 0.9).map((x) => x.text), ["Terms of Service"], "boundaries are inclusive");
  // only the near-certain option is a pick on that path: a 0.25 runner-up is not tried
  assert.deepEqual(near(0.5, 0.92, { [rules.id]: 0.25 }).map((x) => x.text), ["Terms of Service"]);
});

test("summaries", () => {
  assert.equal(linkSummary({ has_terms: { noul: 0.934 }, terms_link: { probabilities: { a: 0.81, b: 0.19 } } }), "link:0.93/0.81");
  assert.equal(linkSummary(null), "off");
  assert.equal(pageSummary({ is_terms: { noul: 0.123 } }), "page:0.12");
  // partial answers never throw
  assert.equal(linkSummary({}), "link:?/?");
  assert.equal(linkSummary({ has_terms: { noul: 0.5 } }), "link:0.50/?");
  assert.equal(linkSummary({ terms_link: { probabilities: { a: 0.4 } } }), "link:?/0.40");
  assert.equal(pageSummary({}), "page:?");
  assert.equal(pageSummary({ is_terms: {} }), "page:?");
});

test("linkEntries: whitespace-only text counts as empty; missing links/clickables are tolerated", () => {
  const e = linkEntries({ url: "https://x.com/", links: [L("   ", "https://x.com/logo", true), L("Terms", "https://x.com/terms", true)] });
  assert.deepEqual(e.map((x) => x.text), ["Terms"]);
  assert.deepEqual(linkEntries({ url: "https://x.com/" }), []);
  assert.deepEqual(linkEntries({ url: "https://x.com/", clickables: [{ text: " ", footer: true }] }), []);
});

test("termsLinkQuestions: no entries means no question (a Choice needs options)", () => {
  assert.equal(termsLinkQuestions([]), null);
});

test("termsPageQuestion caps the text and headings; acceptsPage applies the threshold", () => {
  const q = termsPageQuestion({ url: "https://x.com/" + "p".repeat(300), title: "Rules", headings: Array.from({ length: 40 }, (_, i) => `H${i}`), text: "t".repeat(9000) });
  assert.equal(q.state.page.text.length, 6000);
  assert.equal(q.state.page.url.length, 200, "the URL, capped, so Jev sees the path");
  assert.deepEqual(Object.keys(q.state.page), ["url", "title", "headings", "text"]);
  assert.equal(termsPageQuestion({ title: "T", text: "x" }).state.page.url, "", "no URL: empty");
  assert.equal(q.state.page.headings.length, 30);
  assert.equal(q.questions.is_terms.type, "noul");
  assert.equal(acceptsPage({ is_terms: { noul: 0.7 } }), true);
  assert.equal(acceptsPage({ is_terms: { noul: 0.69 } }), false);
  assert.equal(acceptsPage(null), false);
});

test("askJev: null without a key; retries one 429; returns the answers; throws on other errors", async () => {
  delete process.env.TYPESAFE_API_KEY;
  assert.equal(await askJev({}, {}), null);
  process.env.TYPESAFE_API_KEY = "test-key";
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url, init });
    if (calls.length === 1) return { status: 429, ok: false, headers: new Headers({ "retry-after": "0" }), text: async () => "slow down" };
    return { status: 200, ok: true, headers: new Headers(), json: async () => ({ model: "jev-1.14.0", answers: { x: { type: "noul", noul: 0.5 } } }) };
  };
  const answers = await askJev({ a: 1 }, { x: { type: "noul", instructions: "?" } }, { fetchFn });
  assert.deepEqual(answers, { x: { type: "noul", noul: 0.5 } });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].init.headers.authorization, "Bearer test-key");
  assert.equal(JSON.parse(calls[1].init.body).model, "jev-1.14.0");
  // a second 429 is not retried again
  let n429 = 0;
  await assert.rejects(askJev({}, {}, { fetchFn: async () => { n429++; return { status: 429, ok: false, headers: new Headers({ "retry-after": "0" }), text: async () => "slow" }; } }), /jev http 429/);
  assert.equal(n429, 2);
  // retry-after is honoured
  let t0 = 0, gap = 0, k = 0;
  await askJev({}, {}, { fetchFn: async () => { if (k++ === 0) { t0 = Date.now(); return { status: 429, ok: false, headers: new Headers({ "retry-after": "1" }), text: async () => "" }; } gap = Date.now() - t0; return { status: 200, ok: true, headers: new Headers(), json: async () => ({ answers: {} }) }; } });
  assert.ok(gap >= 900, `waited ${gap}ms`);
  // a 200 without an answers object is a failure, not undefined
  for (const body of [{}, { answers: null }, { answers: "x" }, null]) {
    await assert.rejects(askJev({}, {}, { fetchFn: async () => ({ status: 200, ok: true, headers: new Headers(), json: async () => body }) }), /malformed response/);
  }
  await assert.rejects(askJev({}, {}, { fetchFn: async () => ({ status: 500, ok: false, headers: new Headers(), text: async () => "boom" }) }), /jev http 500/);
  delete process.env.TYPESAFE_API_KEY;
});

test("jevEnabled follows the key", () => {
  const saved = process.env.TYPESAFE_API_KEY;
  try {
    process.env.TYPESAFE_API_KEY = "";
    assert.equal(jevEnabled(), false);
    process.env.TYPESAFE_API_KEY = "k";
    assert.equal(jevEnabled(), true);
  } finally { if (saved === undefined) delete process.env.TYPESAFE_API_KEY; else process.env.TYPESAFE_API_KEY = saved; }
});

test("termsPageQuestion: a product section's terms on a site with other products are not the general terms (elarabet's sportsbook)", () => {
  const q = termsPageQuestion({ url: "https://elarabet.com/spotsbook-terms-and-conditions", title: "Sportsbook", headings: [], text: "x" });
  assert.equal(q.state.page.url, "https://elarabet.com/spotsbook-terms-and-conditions");
  assert.match(q.questions.is_terms.instructions, /govern the whole site \(an online casino, sportsbook or both\)/);
  assert.match(q.questions.is_terms.criteria.false, /the terms of one product section \(sportsbook, poker, bingo, racing, live casino\) of a site that also offers other products/);
  assert.match(q.questions.is_terms.criteria.true, /general terms and conditions, terms of service, terms of use or user agreement/, "true is unchanged");
});

test("lobbyQuestion: URL, title, the first 3,000 characters and up to 60 captions go to a single Choice with the six options", () => {
  const captions = Array.from({ length: 80 }, (_, i) => `Caption ${i} ${"x".repeat(100)}`);
  const { state, questions } = lobbyQuestion({ url: "https://x.example/", title: "Best Casinos 2026", text: "a".repeat(5000), captions });
  assert.equal(state.page.url, "https://x.example/");
  assert.equal(state.page.title, "Best Casinos 2026");
  assert.equal(state.page.text.length, 3000);
  assert.equal(state.page.captions.length, 60);
  assert.ok(state.page.captions.every((c) => c.length <= 60));
  assert.deepEqual(Object.keys(questions), ["kind"]);
  assert.match(questions.kind.instructions, /not from the domain name/);
  assert.equal(questions.kind.type, "choice");
  assert.deepEqual(Object.keys(questions.kind.criteria), ["gambling_site", "geo_or_regulatory_notice", "closed_or_suspended", "parked_or_for_sale", "not_gambling_site", "error_or_bot_wall"]);
});

test("lobbyVerdict: the top option at 0.8 with confidence 0.7 becomes a status; a gambling site, an unsure answer or no answer is null", () => {
  // the live shape: a Choice answer has `choice`, `confidence` and `probabilities`, no `noul`
  const kind = (top, p, confidence = 0.9) => ({ kind: { type: "choice", choice: top, confidence, probabilities: { [top]: p, gambling_site: top === "gambling_site" ? p : 1 - p } } });
  assert.equal(lobbyVerdict(kind("not_gambling_site", 0.92)), "not_casino");
  assert.equal(lobbyVerdict(kind("geo_or_regulatory_notice", 0.85)), "geo_blocked");
  assert.equal(lobbyVerdict(kind("closed_or_suspended", 0.8)), "closed");
  assert.equal(lobbyVerdict(kind("parked_or_for_sale", 0.9)), "parked");
  assert.equal(lobbyVerdict(kind("error_or_bot_wall", 0.9)), "blocked_http");
  assert.equal(lobbyVerdict(kind("not_gambling_site", 0.7)), null, "probability below 0.8");
  assert.equal(lobbyVerdict(kind("not_gambling_site", 0.92, 0.5)), null, "confidence below 0.7");
  assert.equal(lobbyVerdict({ kind: { type: "choice", choice: "not_gambling_site", confidence: 0.99, probabilities: { gambling_site: 0.01, geo_or_regulatory_notice: 0, closed_or_suspended: 0, parked_or_for_sale: 0, not_gambling_site: 0.99, error_or_bot_wall: 0 } } }), "not_casino", "the live answer for an affiliate site");
  assert.equal(lobbyVerdict({ kind: { noul: 0.9, probabilities: { not_gambling_site: 0.92 } } }), "not_casino", "noul as a fallback");
  assert.equal(lobbyVerdict({ kind: { probabilities: { not_gambling_site: 0.92 } } }), null, "no confidence never passes");
  assert.equal(lobbyVerdict(kind("gambling_site", 0.95)), null);
  assert.equal(lobbyVerdict({ kind: { confidence: 0.9, probabilities: { somewhere_else: 0.99 } } }), null, "an unknown option");
  assert.equal(lobbyVerdict(null), null);
  assert.equal(lobbyVerdict({}), null);
  assert.equal(lobbySummary(kind("not_gambling_site", 0.92)), "lobby:not_gambling_site:0.92");
  assert.equal(lobbySummary(null), "off");
});
