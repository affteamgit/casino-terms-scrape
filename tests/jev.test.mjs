import { test } from "node:test";
import assert from "node:assert/strict";
import { askJev, linkEntries, termsLinkQuestions, jevPicks, linkSummary, termsPageQuestion, acceptsPage, pageSummary, jevEnabled, MAX_ENTRIES } from "../src/jev.mjs";

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

test("linkEntries: a non-footer link joins only when it looks legal, and the list is capped", () => {
  const links = Array.from({ length: 80 }, (_, i) => L(`Game ${i}`, `https://x.com/g/${i}`, true));
  links.push(L("User Agreement", "https://x.com/legal/user-agreement"), L("Blackjack", "https://x.com/blackjack"));
  const e = linkEntries({ url: "https://x.com/", links, clickables: [] });
  assert.equal(e.length, MAX_ENTRIES);
  assert.ok(e.some((x) => x.text === "User Agreement"), "the legal-looking link is kept ahead of the cap");
  assert.ok(!e.some((x) => x.text === "Blackjack"));
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
  const q = termsPageQuestion({ title: "Rules", headings: Array.from({ length: 40 }, (_, i) => `H${i}`), text: "t".repeat(9000) });
  assert.equal(q.state.page.text.length, 6000);
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
