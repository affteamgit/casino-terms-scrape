import { test } from "node:test";
import assert from "node:assert/strict";
import { askJev, linkEntries, termsLinkQuestions, jevPicks, linkSummary, termsPageQuestion, acceptsPage, pageSummary, exclusionQuestion, acceptsBorderline, PAGE_NOUL_BORDER, EXCLUSION_MAX, jevEnabled, MAX_ENTRIES, lobbyQuestion, lobbyVerdict, lobbySummary } from "../src/jev.mjs";

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
  // a borderline page: both answers
  assert.equal(pageSummary({ type: "noul", is_terms: { type: "noul", noul: 0.65 } }, { not_general: { type: "noul", noul: 0.123 } }), "page:0.65 excl:0.12");
  assert.equal(pageSummary({ is_terms: { noul: 0.65 } }, {}), "page:0.65 excl:?");
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
  assert.deepEqual(Object.keys(q.state.page), ["url", "title", "headings", "text", "core"]);
  assert.equal(q.state.page.core, false, "the full text unless told it is the core");
  assert.equal(termsPageQuestion({ title: "T", text: "x" }).state.page.url, "", "no URL: empty");
  assert.equal(q.state.page.headings.length, 30);
  assert.equal(q.questions.is_terms.type, "noul");
  assert.equal(acceptsPage({ is_terms: { noul: 0.7 } }), true);
  assert.equal(acceptsPage({ is_terms: { noul: 0.69 } }), false);
  assert.equal(acceptsPage(null), false);
});

const reply = (status, text = "", body = { answers: {} }) => ({ status, ok: status >= 200 && status < 300, headers: new Headers(), text: async () => text, json: async () => body });
// A fake fetch answering from a sequence (a function entry is called: it may throw), and a fake sleep recording its delays.
const sequence = (...steps) => { const calls = []; const fetch = async (url, init) => { calls.push({ url, init }); const s = steps[Math.min(calls.length - 1, steps.length - 1)]; return typeof s === "function" ? s() : s; }; return { fetch, calls }; };
const recorder = () => { const delays = []; return { sleep: async (ms) => { delays.push(ms); }, delays }; };

test("askJev: null without a key; sends the key and the pinned model; a malformed 200 is a failure", async () => {
  delete process.env.TYPESAFE_API_KEY;
  assert.equal(await askJev({}, {}), null);
  process.env.TYPESAFE_API_KEY = "test-key";
  try {
    const { fetch, calls } = sequence(reply(200, "", { model: "jev-1.14.0", answers: { x: { type: "noul", noul: 0.5 } } }));
    const { sleep, delays } = recorder();
    assert.deepEqual(await askJev({ a: 1 }, { x: { type: "noul", instructions: "?" } }, { fetch, sleep }), { x: { type: "noul", noul: 0.5 } });
    assert.equal(calls.length, 1);
    assert.deepEqual(delays, []);
    assert.equal(calls[0].init.headers.authorization, "Bearer test-key");
    assert.equal(JSON.parse(calls[0].init.body).model, "jev-1.14.0");
    for (const body of [{}, { answers: null }, { answers: "x" }, null]) {
      const f = sequence(reply(200, "", body));
      await assert.rejects(askJev({}, {}, { fetch: f.fetch, sleep }), /malformed response/);
      assert.equal(f.calls.length, 1, "a malformed answer is not retried");
    }
  } finally { delete process.env.TYPESAFE_API_KEY; }
});

test("askJev: an overloaded API (529) answered twice then 200 resolves after waits of 2 s and 5 s", async () => {
  process.env.TYPESAFE_API_KEY = "test-key";
  try {
    const { fetch, calls } = sequence(reply(529, '{"detail":{"error_type":"system_overloaded"}}'), reply(529, "overloaded"), reply(200, "", { answers: { ok: { type: "noul", noul: 1 } } }));
    const { sleep, delays } = recorder();
    assert.deepEqual(await askJev({}, {}, { fetch, sleep }), { ok: { type: "noul", noul: 1 } });
    assert.equal(calls.length, 3);
    assert.deepEqual(delays, [2000, 5000]);
  } finally { delete process.env.TYPESAFE_API_KEY; }
});

test("askJev: four failures in a row throw the last error in the `jev http <status>: <body>` form, after waits of 2, 5 and 10 s", async () => {
  process.env.TYPESAFE_API_KEY = "test-key";
  try {
    const { fetch, calls } = sequence(reply(529, "first"), reply(503, "second"), reply(500, "third"), reply(529, '{"detail":{"error_type":"system_overloaded"}}'));
    const { sleep, delays } = recorder();
    await assert.rejects(askJev({}, {}, { fetch, sleep }), (e) => { assert.equal(e.message, 'jev http 529: {"detail":{"error_type":"system_overloaded"}}'); return true; });
    assert.equal(calls.length, 4, "four attempts, no more");
    assert.deepEqual(delays, [2000, 5000, 10000]);
  } finally { delete process.env.TYPESAFE_API_KEY; }
});

test("askJev: 429 and every 5xx are retried", async () => {
  process.env.TYPESAFE_API_KEY = "test-key";
  try {
    for (const status of [429, 500, 502, 503, 504, 529]) {
      const { fetch, calls } = sequence(reply(status, "busy"), reply(200, "", { answers: {} }));
      const { sleep, delays } = recorder();
      assert.deepEqual(await askJev({}, {}, { fetch, sleep }), {}, `status ${status}`);
      assert.equal(calls.length, 2, `status ${status}`);
      assert.deepEqual(delays, [2000], `status ${status}`);
    }
  } finally { delete process.env.TYPESAFE_API_KEY; }
});

test("askJev: a 5xx whose body cannot be read is still retried, and the error keeps the `jev http <status>:` form", async () => {
  process.env.TYPESAFE_API_KEY = "test-key";
  try {
    const unreadable = (status) => ({ ...reply(status), text: async () => { throw new TypeError("terminated"); } });
    const { fetch, calls } = sequence(unreadable(502), reply(200, "", { answers: { ok: { type: "noul", noul: 1 } } }));
    const { sleep, delays } = recorder();
    assert.deepEqual(await askJev({}, {}, { fetch, sleep }), { ok: { type: "noul", noul: 1 } });
    assert.equal(calls.length, 2);
    assert.deepEqual(delays, [2000]);
    const all = sequence(unreadable(503));
    await assert.rejects(askJev({}, {}, { fetch: all.fetch, sleep }), (e) => { assert.equal(e.message, "jev http 503: "); return true; });
    assert.equal(all.calls.length, 4);
  } finally { delete process.env.TYPESAFE_API_KEY; }
});

test("askJev: a retry-after of up to 30 s replaces the schedule's wait for that attempt; a longer or unreadable one does not", async () => {
  process.env.TYPESAFE_API_KEY = "test-key";
  try {
    const withRetryAfter = (status, value) => ({ ...reply(status, "slow"), headers: new Headers(value === undefined ? {} : { "retry-after": value }) });
    for (const [value, expected] of [["3", 3000], ["30", 30000], ["0", 0], ["120", 2000], ["31", 2000], ["soon", 2000], ["", 2000], [undefined, 2000]]) {
      const { fetch, calls } = sequence(withRetryAfter(429, value), reply(200, "", { answers: {} }));
      const { sleep, delays } = recorder();
      assert.deepEqual(await askJev({}, {}, { fetch, sleep }), {});
      assert.equal(calls.length, 2);
      assert.deepEqual(delays, [expected], `retry-after ${JSON.stringify(value)}`);
    }
    // it applies to its own attempt only, and the schedule still bounds the attempts at four
    const { fetch, calls } = sequence(withRetryAfter(529, "3"), reply(503, "x"), withRetryAfter(429, "1"), withRetryAfter(529, "1"));
    const { sleep, delays } = recorder();
    await assert.rejects(askJev({}, {}, { fetch, sleep }), /^Error: jev http 529: slow$/);
    assert.equal(calls.length, 4);
    assert.deepEqual(delays, [3000, 5000, 1000]);
  } finally { delete process.env.TYPESAFE_API_KEY; }
});

test("askJev: a 4xx other than 429 throws at once, with no wait and no second call", async () => {
  process.env.TYPESAFE_API_KEY = "test-key";
  try {
    for (const status of [400, 401, 403, 404, 422]) {
      const { fetch, calls } = sequence(reply(status, "bad request"), reply(200, "", { answers: {} }));
      const { sleep, delays } = recorder();
      await assert.rejects(askJev({}, {}, { fetch, sleep }), new RegExp(`^Error: jev http ${status}: bad request$`));
      assert.equal(calls.length, 1, `status ${status}`);
      assert.deepEqual(delays, [], `status ${status}`);
    }
  } finally { delete process.env.TYPESAFE_API_KEY; }
});

test("askJev: a network failure (TypeError: fetch failed) twice then 200 resolves after waits of 2 s and 5 s; four in a row throw the last", async () => {
  process.env.TYPESAFE_API_KEY = "test-key";
  try {
    const down = () => { throw new TypeError("fetch failed"); };
    const a = sequence(down, down, reply(200, "", { answers: { y: { type: "noul", noul: 0.1 } } }));
    const ra = recorder();
    assert.deepEqual(await askJev({}, {}, { fetch: a.fetch, sleep: ra.sleep }), { y: { type: "noul", noul: 0.1 } });
    assert.equal(a.calls.length, 3);
    assert.deepEqual(ra.delays, [2000, 5000]);
    let n = 0;
    const b = sequence(() => { throw new TypeError(`fetch failed ${++n}`); });
    const rb = recorder();
    await assert.rejects(askJev({}, {}, { fetch: b.fetch, sleep: rb.sleep }), /^TypeError: fetch failed 4$/);
    assert.equal(b.calls.length, 4);
    assert.deepEqual(rb.delays, [2000, 5000, 10000]);
  } finally { delete process.env.TYPESAFE_API_KEY; }
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

test("lobbyQuestion: URL, title, the first 3,000 characters and up to 60 captions go to a single Choice with the seven options", () => {
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
  assert.deepEqual(Object.keys(questions.kind.criteria), ["gambling_site", "geo_or_regulatory_notice", "closed_or_suspended", "temporarily_unavailable", "parked_or_for_sale", "not_gambling_site", "error_or_bot_wall"]);
  // closed is terminal (never retried): the option says permanent, and the temporary states have their own option
  assert.match(questions.kind.criteria.closed_or_suspended, /permanently/);
  assert.match(questions.kind.criteria.closed_or_suspended, /not a temporary outage, maintenance or a licence suspension/);
  assert.match(questions.kind.criteria.temporarily_unavailable, /maintenance/);
});

test("lobbyVerdict: the top option at 0.8 with confidence 0.7 becomes a status; a gambling site, an unsure answer or no answer is null", () => {
  // the live shape: a Choice answer has `choice`, `confidence` and `probabilities`, no `noul`
  const kind = (top, p, confidence = 0.9) => ({ kind: { type: "choice", choice: top, confidence, probabilities: { [top]: p, gambling_site: top === "gambling_site" ? p : 1 - p } } });
  assert.equal(lobbyVerdict(kind("not_gambling_site", 0.92)), "not_casino");
  assert.equal(lobbyVerdict(kind("geo_or_regulatory_notice", 0.85)), "geo_blocked");
  assert.equal(lobbyVerdict(kind("closed_or_suspended", 0.8)), "closed");
  assert.equal(lobbyVerdict(kind("parked_or_for_sale", 0.9)), "parked");
  assert.equal(lobbyVerdict(kind("error_or_bot_wall", 0.9)), "blocked_http");
  assert.equal(lobbyVerdict(kind("temporarily_unavailable", 0.9)), "maintenance", "a temporary state is not terminal");
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

// A text that reads like terms (readsLikeTerms: 2,000 characters, 5 terms words) and one that does not.
const LONG_TERMS = "These terms and conditions govern your account, deposits, bets and withdrawals. ".repeat(40);
const LONG_OTHER = "Play slots and live games every day with fast payouts and friendly support. ".repeat(40);

test("termsPageQuestion: the text sent may be the page's core (what it adds beyond the lobby), and the state says so", () => {
  const q = termsPageQuestion({ url: "https://x.com/terms", title: "Terms", headings: [], text: LONG_TERMS, core: true });
  assert.equal(q.state.page.core, true);
  assert.equal(q.state.page.text, LONG_TERMS.slice(0, 6000));
});

test("exclusionQuestion: one Noul question, not_general, about the same page state", () => {
  const meta = { url: "https://x.com/en/terms/bonus/", title: "Bonus Terms", headings: ["Bonus"], text: LONG_TERMS, core: true };
  const q = exclusionQuestion(meta);
  assert.deepEqual(q.state, termsPageQuestion(meta).state, "the same page as the terms question");
  assert.deepEqual(Object.keys(q.questions), ["not_general"]);
  assert.equal(q.questions.not_general.type, "noul");
  assert.match(q.questions.not_general.instructions, /promotion's or bonus terms, one product section's terms \(sportsbook, poker, bingo, racing, live casino\), a privacy or cookie policy, game or betting rules, a help article, or anything other than the general terms and conditions of the whole site/);
  assert.ok(q.questions.not_general.criteria.true && q.questions.not_general.criteria.false);
  assert.match(q.questions.not_general.criteria.false, /general terms and conditions/);
});

test("acceptsBorderline: page 0.5 or more, exclusion 0.3 or less, and the text reads like terms", () => {
  assert.equal(PAGE_NOUL_BORDER, 0.5);
  assert.equal(EXCLUSION_MAX, 0.3);
  assert.equal(acceptsBorderline({ is_terms: { noul: 0.65 } }, { not_general: { noul: 0.12 } }, LONG_TERMS), true);
  assert.equal(acceptsBorderline({ is_terms: { noul: 0.5 } }, { not_general: { noul: 0.3 } }, LONG_TERMS), true, "both thresholds inclusive");
  assert.equal(acceptsBorderline({ is_terms: { noul: 0.65 } }, { not_general: { noul: 0.4 } }, LONG_TERMS), false, "Jev does not rule out the exclusions");
  assert.equal(acceptsBorderline({ is_terms: { noul: 0.45 } }, { not_general: { noul: 0.12 } }, LONG_TERMS), false, "below the band");
  assert.equal(acceptsBorderline({ is_terms: { noul: 0.65 } }, { not_general: { noul: 0.12 } }, LONG_OTHER), false, "does not read like terms");
  assert.equal(acceptsBorderline({ is_terms: { noul: 0.65 } }, {}, LONG_TERMS), false, "no exclusion answer");
  assert.equal(acceptsBorderline(null, null, LONG_TERMS), false);
});
